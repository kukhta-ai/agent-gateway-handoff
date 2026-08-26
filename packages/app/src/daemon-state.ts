import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { StringSetStore } from "@gla/capability";
import {
  type CapabilityId,
  type MutableRevocations,
  type RevocationSnapshot,
  redactOperatorText,
} from "@gla/kernel";

const STATE_SCHEMA_VERSION = 1;
const STATE_KEY_BYTES = 32;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_FILE = "daemon.lock";

interface StateRootLockRecord {
  fd: number;
  path: string;
  refs: number;
}

const STATE_ROOT_LOCKS = new Map<string, StateRootLockRecord>();

interface StateEnvelope {
  schemaVersion: 1;
  kind: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  updatedAt: string;
}

/** Classification metadata required by GLA-081's security architecture gate. */
export interface PersistedRecordClassification {
  kind: string;
  owner: string;
  classification: "secret" | "sensitive" | "critical-operational" | "non-sensitive";
  recovery: string;
  retention: string;
  disposal: string;
}

/** The daemon-owned persisted record kinds and lifecycle classifications. */
export const DAEMON_PERSISTED_RECORDS: readonly PersistedRecordClassification[] = [
  {
    kind: "daemon.owner-lock",
    owner: "@gla/app",
    classification: "critical-operational",
    recovery:
      "refuses concurrent daemons for the same state root; stale locks require operator inspection",
    retention: "while a daemon owns the state root",
    disposal:
      "removed on clean daemon shutdown or deliberate operator recovery after verifying no owner",
  },
  {
    kind: "identity.enrollments",
    owner: "@gla/identity",
    classification: "sensitive",
    recovery: "restore before handoff step-up; invalid records make the recipient unenrolled",
    retention: "until explicit re-enrollment, removal, or incident cleanup",
    disposal: "delete or replace on re-enrollment/removal with redacted audit context",
  },
  {
    kind: "provider.webauthn.v1.credentials",
    owner: "@gla/auth-webauthn",
    classification: "sensitive",
    recovery: "restore credential public key/counter before WebAuthn step-up",
    retention: "until re-enrollment/removal",
    disposal: "delete on re-enrollment/removal; never expose raw credential details in diagnostics",
  },
  {
    kind: "provider.webauthn.v1.challenges",
    owner: "@gla/auth-webauthn",
    classification: "secret",
    recovery: "unexpired challenges may complete; stale or wrong-kind challenges fail closed",
    retention: "ceremony TTL plus replay margin",
    disposal: "delete on claim, completion, expiry, or incident cleanup",
  },
  {
    kind: "provider.authentik.v1.subjects",
    owner: "@gla/auth-authentik",
    classification: "sensitive",
    recovery: "restore stable userId-to-sub binding exactly; mismatch fails closed",
    retention: "until re-enrollment/removal",
    disposal: "delete on re-enrollment/removal or identity binding incident",
  },
  {
    kind: "provider.authentik.v1.attempts",
    owner: "@gla/auth-authentik",
    classification: "secret",
    recovery: "unexpired pending OIDC attempts may complete once; consumed/expired attempts refuse",
    retention: "attempt TTL plus replay tombstone margin",
    disposal: "delete on claim, expiry, failure, or incident cleanup",
  },
  {
    kind: "provider.secret-store-reference.v1.refs",
    owner: "@gla/provider-set-reference",
    classification: "secret",
    recovery: "restore opaque secret-ref bindings before any provider injects a referenced value",
    retention:
      "until the owning task/session/provider cleanup deletes the ref or retention expires",
    disposal: "delete secret-ref bindings without exposing raw values in diagnostics",
  },
  {
    kind: "capability.signing-key",
    owner: "@gla/kernel",
    classification: "secret",
    recovery: "restore before verifying previously issued capabilities",
    retention: "until explicit key rotation invalidates prior tokens",
    disposal: "rotate only with operator acknowledgement and grant invalidation",
  },
  {
    kind: "capability.revocations",
    owner: "@gla/capability",
    classification: "critical-operational",
    recovery: "load before public traffic so revoked lineage never authorizes",
    retention: "at least max descendant token TTL plus audit grace",
    disposal: "compact only after every related token is dead",
  },
  {
    kind: "capability.spent-enrollment-nonces",
    owner: "@gla/capability",
    classification: "critical-operational",
    recovery: "load before enrollment traffic so spent operator-discharge grants stay spent",
    retention: "enrollment grant TTL plus replay grace",
    disposal: "compact after grant TTL and audit grace",
  },
  {
    kind: "task.state",
    owner: "@gla/task",
    classification: "secret",
    recovery:
      "restore task aggregates and encrypted held task-capability tokens before bridge operations",
    retention: "task lifetime plus audit/repair grace",
    disposal:
      "delete encrypted task-capability tokens when task lifecycle is terminal and retention expires",
  },
  {
    kind: "session.state",
    owner: "@gla/session",
    classification: "critical-operational",
    recovery:
      "restore sessions, handoff windows, provision records, and completion envelopes; open windows safe-close unless routes are explicitly restored",
    retention: "session/window lifetime plus grant TTL and audit grace",
    disposal:
      "clear connector refs, route refs, runtime handles, and terminal windows after cleanup/retention",
  },
  {
    kind: "worker.lifecycle",
    owner: "@gla/worker",
    classification: "critical-operational",
    recovery:
      "restore live capsule records so restart cleanup can stop launcher runtimes and reap workspaces",
    retention: "live capsule lifetime only",
    disposal: "delete records before idempotent teardown work so repeated cleanup converges",
  },
] as const;

/** Error thrown when persisted daemon state cannot be used safely. */
export class DaemonStateError extends Error {
  readonly code:
    | "state.unsafe_permissions"
    | "state.unsafe_path"
    | "state.integrity"
    | "state.schema"
    | "state.locked"
    | "state.unavailable";

  constructor(code: DaemonStateError["code"], message: string) {
    super(message);
    this.name = "DaemonStateError";
    this.code = code;
  }
}

/** Redact bearer/credential-shaped values before diagnostics, repair output, logs, or public errors. */
export function redactDaemonState(value: unknown): string {
  return redactOperatorText(value);
}

/** Secure daemon state root. Concrete filesystem mechanics live in the app composition root. */
export class DaemonStateRoot {
  readonly root: string;
  private readonly key: Buffer;
  private readonly lock: StateRootLock;

  private constructor(root: string, key: Buffer, lock: StateRootLock) {
    this.root = root;
    this.key = key;
    this.lock = lock;
  }

  static open(opts: { root: string; unsafeRoots?: string[] }): DaemonStateRoot {
    const root = safeResolve(opts.root);
    assertNotSymlink(root);
    if (existsSync(root)) {
      assertDirectoryMode(root, DIR_MODE);
    } else {
      mkdirSync(root, { recursive: true, mode: DIR_MODE });
    }
    chmodSync(root, DIR_MODE);
    assertDirectoryMode(root, DIR_MODE);
    assertOutsideUnsafeRoots(root, opts.unsafeRoots ?? []);
    const lock = acquireStateRootLock(root);

    const records = join(root, "records");
    assertNotSymlink(records);
    if (existsSync(records)) {
      assertDirectoryMode(records, DIR_MODE);
    } else {
      mkdirSync(records, { recursive: true, mode: DIR_MODE });
    }
    chmodSync(records, DIR_MODE);
    assertDirectoryMode(records, DIR_MODE);

    const keyPath = join(root, "state.key");
    const key = loadOrCreateKey(keyPath);
    return new DaemonStateRoot(root, key, lock);
  }

  /** Release the daemon state-root ownership lock during graceful shutdown. */
  close(): void {
    this.lock.release();
  }

  file<T>(kind: string, fallback: T): SecureStateFile<T> {
    return new SecureStateFile<T>(this, kind, fallback);
  }

  kv<V>(kind: string): PersistentKvStore<V> {
    return new PersistentKvStore<V>(this.file<Record<string, V>>(kind, {}));
  }

  stringSet(kind: string): PersistentStringSetStore {
    return new PersistentStringSetStore(this.file<string[]>(kind, []));
  }

  revocations(kind = "capability.revocations"): PersistentRevocations {
    return new PersistentRevocations(this.file<string[]>(kind, []));
  }

  secretBytes(kind: string, length: number): Buffer {
    const file = this.file<{ value?: string }>(kind, {});
    const current = file.read().value;
    if (current !== undefined) {
      const decoded = Buffer.from(current, "base64url");
      if (decoded.length !== length) {
        throw new DaemonStateError(
          "state.integrity",
          `persisted secret ${kind} has invalid length`,
        );
      }
      return decoded;
    }
    const generated = randomBytes(length);
    file.write({ value: generated.toString("base64url") });
    return generated;
  }

  encrypt(kind: string, value: unknown): StateEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(kind, "utf8"));
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: StateEnvelope = {
      schemaVersion: STATE_SCHEMA_VERSION,
      kind,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      updatedAt: new Date().toISOString(),
    };
    return envelope;
  }

  decrypt<T>(kind: string, envelope: StateEnvelope): T {
    if (envelope.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new DaemonStateError("state.schema", `unsupported state schema for ${kind}`);
    }
    if (envelope.kind !== kind) {
      throw new DaemonStateError("state.integrity", `state kind mismatch for ${kind}`);
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(envelope.nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(kind, "utf8"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    } catch (error) {
      throw new DaemonStateError(
        "state.integrity",
        `state record ${kind} failed integrity validation: ${redactDaemonState(String(error))}`,
      );
    }
  }

  recordPath(kind: string): string {
    return join(this.root, "records", `${safeKind(kind)}.json`);
  }

  /** Existing daemon record kinds, optionally filtered by prefix, for recovery preflight checks. */
  recordKinds(prefix = ""): string[] {
    return readdirSync(join(this.root, "records"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((kind) => kind.startsWith(prefix))
      .sort();
  }
}

/** Encrypted/authenticated JSON record file with atomic replace writes. */
export class SecureStateFile<T> {
  private readonly state: DaemonStateRoot;
  private readonly kind: string;
  private readonly fallback: T;
  private cache: T | undefined;

  constructor(state: DaemonStateRoot, kind: string, fallback: T) {
    this.state = state;
    this.kind = kind;
    this.fallback = fallback;
  }

  read(): T {
    if (this.cache !== undefined) {
      return clone(this.cache);
    }
    const path = this.state.recordPath(this.kind);
    if (!existsSync(path)) {
      this.cache = clone(this.fallback);
      return clone(this.cache);
    }
    assertFileMode(path, FILE_MODE);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StateEnvelope;
    this.cache = this.state.decrypt<T>(this.kind, parsed);
    return clone(this.cache);
  }

  write(value: T): void {
    const path = this.state.recordPath(this.kind);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
    const envelope = this.state.encrypt(this.kind, value);
    writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`, { mode: FILE_MODE });
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, path);
    chmodSync(path, FILE_MODE);
    this.cache = clone(value);
  }
}

/** Generic persistent key-value store compatible with auth adapter KV seams. */
export class PersistentKvStore<V> {
  constructor(private readonly file: SecureStateFile<Record<string, V>>) {}

  get(key: string): V | undefined {
    return this.file.read()[key];
  }

  set(key: string, value: V): void {
    const next = this.file.read();
    next[key] = value;
    this.file.write(next);
  }

  delete(key: string): void {
    const next = this.file.read();
    delete next[key];
    this.file.write(next);
  }

  entries(): Array<[string, V]> {
    return Object.entries(this.file.read()).sort(([a], [b]) => a.localeCompare(b));
  }
}

/** Persistent string set for spent nonces and similar security tombstones. */
export class PersistentStringSetStore implements StringSetStore {
  constructor(private readonly file: SecureStateFile<string[]>) {}

  has(value: string): boolean {
    return new Set(this.file.read()).has(value);
  }

  add(value: string): void {
    const next = new Set(this.file.read());
    const before = next.size;
    next.add(value);
    if (next.size !== before) {
      this.file.write([...next].sort());
    }
  }

  delete(value: string): void {
    const next = new Set(this.file.read());
    if (next.delete(value)) {
      this.file.write([...next].sort());
    }
  }
}

/** Persistent mutable revocation cache; edge verification still receives immutable snapshots. */
export class PersistentRevocations implements MutableRevocations {
  version = "0";

  constructor(private readonly file: SecureStateFile<string[]>) {
    this.version = String(this.file.read().length);
  }

  has(id: CapabilityId): boolean {
    return new Set(this.file.read()).has(id);
  }

  add(id: CapabilityId): void {
    const next = new Set(this.file.read());
    const before = next.size;
    next.add(id);
    if (next.size !== before) {
      const values = [...next].sort();
      this.file.write(values);
      this.version = String(values.length);
    }
  }

  snapshot(): RevocationSnapshot {
    const values = new Set(this.file.read());
    const version = this.version;
    return { has: (id) => values.has(id), version };
  }

  values(): CapabilityId[] {
    return this.file.read() as CapabilityId[];
  }
}

function loadOrCreateKey(path: string): Buffer {
  if (existsSync(path)) {
    assertFileMode(path, FILE_MODE);
    const value = readFileSync(path, "utf8").trim();
    const key = Buffer.from(value, "base64url");
    if (key.length !== STATE_KEY_BYTES) {
      throw new DaemonStateError("state.integrity", "daemon state key has invalid length");
    }
    return key;
  }
  const key = randomBytes(STATE_KEY_BYTES);
  const fd = openSync(path, "wx", FILE_MODE);
  try {
    writeFileSync(fd, `${key.toString("base64url")}\n`);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, FILE_MODE);
  return key;
}

function safeResolve(path: string): string {
  if (path.trim().length === 0) {
    throw new DaemonStateError("state.unsafe_path", "empty daemon state root");
  }
  return isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
}

function assertNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new DaemonStateError("state.unsafe_path", `daemon state path is a symlink: ${path}`);
  }
}

function assertOutsideUnsafeRoots(root: string, unsafeRoots: string[]): void {
  const realRoot = realpathSync(root);
  for (const unsafe of unsafeRoots) {
    if (!existsSync(unsafe)) {
      continue;
    }
    const realUnsafe = realpathSync(unsafe);
    if (realRoot === realUnsafe || realRoot.startsWith(`${realUnsafe}${sep}`)) {
      throw new DaemonStateError(
        "state.unsafe_path",
        `daemon state root must not live under agent/capsule-controlled path: ${realUnsafe}`,
      );
    }
  }
}

class StateRootLock {
  private released = false;

  constructor(private readonly realRoot: string) {}

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    const lock = STATE_ROOT_LOCKS.get(this.realRoot);
    if (lock === undefined) {
      return;
    }
    lock.refs -= 1;
    if (lock.refs > 0) {
      return;
    }
    STATE_ROOT_LOCKS.delete(this.realRoot);
    closeSync(lock.fd);
    try {
      unlinkSync(lock.path);
    } catch {
      // A stale or externally removed lock still means this process no longer owns it.
    }
  }
}

function acquireStateRootLock(root: string): StateRootLock {
  const realRoot = realpathSync(root);
  const existing = STATE_ROOT_LOCKS.get(realRoot);
  if (existing !== undefined) {
    existing.refs += 1;
    return new StateRootLock(realRoot);
  }
  const lockPath = join(root, LOCK_FILE);
  assertNotSymlink(lockPath);
  let fd: number;
  try {
    fd = openSync(lockPath, "wx", FILE_MODE);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "EEXIST") {
      throw new DaemonStateError(
        "state.locked",
        `daemon state root is already owned or has a stale lock: ${lockPath}`,
      );
    }
    throw error;
  }
  try {
    chmodSync(lockPath, FILE_MODE);
    writeSync(
      fd,
      `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
    );
    STATE_ROOT_LOCKS.set(realRoot, { fd, path: lockPath, refs: 1 });
    return new StateRootLock(realRoot);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Ignore cleanup failure; startup fails closed with the original error.
    }
    throw error;
  }
}

function assertDirectoryMode(path: string, expected: number): void {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    throw new DaemonStateError(
      "state.unsafe_path",
      `daemon state root is not a directory: ${path}`,
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new DaemonStateError(
      "state.unsafe_permissions",
      `daemon state directory must be ${modeString(expected)} and not group/world accessible: ${path}`,
    );
  }
}

function assertFileMode(path: string, expected: number): void {
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new DaemonStateError("state.unsafe_path", `daemon state record is not a file: ${path}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new DaemonStateError(
      "state.unsafe_permissions",
      `daemon state file must be ${modeString(expected)} and not group/world accessible: ${path}`,
    );
  }
}

function safeKind(kind: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(kind)) {
    throw new DaemonStateError("state.unsafe_path", `invalid daemon state record kind: ${kind}`);
  }
  return kind;
}

function modeString(mode: number): string {
  return `0${mode.toString(8)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
