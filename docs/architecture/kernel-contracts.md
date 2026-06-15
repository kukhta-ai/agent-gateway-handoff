# GLA — Kernel & Cross-Module Contracts (GLA-002)

> **Status:** Contract bible. **Scope:** the shared vocabulary, entities, ports, schemas, and taxonomies every
> module depends on — designed once so nothing drifts. This is the artifact **GLA-003 (scaffold)** and
> **GLA-004 (kernel build)** implement against.
>
> **This is a *contract specification*, not implementation.** The TypeScript below is **interface/type sketch**
> — the published *shape*, not the code. Bodies, signing math, persistence, and concrete adapters are out of
> scope (they are GLA-004 and later). It conforms to the fixed spec (`docs/01`–`05`, `docs/components/*`) and
> the realization choices in `docs/architecture/baseline.md`; cross-references (`see docs/<x>`) are the source
> of truth and are not restated.

## How this was produced (Rule-3 note)

The BMAD architect persona (`bmad-agent-architect`, "Winston") **was invoked** and is available, but it
activates as an **interactive menu-driven persona** — its activation step 8 is "Stop and wait for input", and
every menu path dispatches into the `bmad-create-architecture` workflow, which itself mandates "NEVER generate
content without user input" and gates on human confirmation + a PRD. It **cannot run unattended** in this
subagent context. Per `AGENTS.md` Rule 3's explicit allowance, that path was stopped, the blocker named, and
this artifact was driven **from the committed design set** as the stated fallback.

**Conventions for the sketches below.** `Iso8601`, `Duration` (e.g. `"1h"`), and `Ref<…>` (an opaque
capability/handle reference) are nominal aliases. All ids are prefixed strings (`task_…`, `sess_…`, `hand_…`,
`cap_…`, `route_…`). Every contract is **transport-agnostic** (CLI and MCP are two surfaces over it, `docs/05`)
and **signing-agnostic / persistence-agnostic** (those are adapter details). `kind` discriminants make every
union exhaustively checkable.

---

## §0 · Where these contracts live (package map)

All of this is the `kernel` package (`see baseline.md §1`): pure domain types + **port interfaces** + the error
taxonomy. Aggregates (`task, session, capability, route, completion, audit`) are core packages that depend
*only* on `kernel`. Ports are interfaces in `kernel`; their concrete adapters live under `adapters/**` and are
injected at the `app` composition root — **the kernel names no concrete adapter** (`GLA-004 AC#7`, AC #6 below).

---

## §1 · Core entities — fields & lifecycles (AC #1)

### 1.1 Task — the multi-step goal (`see docs/components/task-service.md`)

```ts
type TaskState = "active" | "completed" | "revoked" | "failed";

interface Task {
  id: `task_${string}`;
  recipient?: RecipientRef;          // opaque; bound from the channel, narrow-only
  intentLabel?: string;              // opaque to the system — agent cognition, never parsed
  state: TaskState;
  sessions: Array<Session["id"]>;    // ordered chain
  stepCounters: { opened: number; completed: number };
  taskCapabilityRef: Ref<"task">;    // parent = agent-authority
  createdAt: Iso8601; updatedAt: Iso8601;
  implicit: boolean;                 // true when auto-created by `session create` w/o --task
}
```
**Lifecycle:** `active → completed | revoked | failed`. `completed`/`revoked` are terminal and cascade teardown
+ revocation to descendant sessions/capsules. A failing step leaves the task `active` (repair resumes from
recorded state — not a restart). Task state is the *aggregate* of its sessions, never a parallel truth.

### 1.2 Session — the per-handoff unit / one capsule's lifecycle (`see session-service.md`)

```ts
type SessionState =
  | "proposed" | "issued" | "opened" | "active"
  | "completed" | "revoked" | "expired" | "failed";

interface Session {
  id: `sess_${string}`;
  taskId: Task["id"];
  stepName?: string;
  spec: ResolvedAssemblySpec;        // IMMUTABLE after admission (§3)
  state: SessionState;
  grantTokenRef?: Ref<"session">;    // the current window's recipient-bound grant, if open
  route?: Route;                     // programmed while a window is open
  runtime?: RuntimeHandle;           // the live capsule handle from the worker plane
  recipient?: RecipientRef;
  completion?: CompletionEnvelope;   // last validated completion
  createdAt: Iso8601; updatedAt: Iso8601; expiresAt?: Iso8601;
}
```
**Lifecycle (canonical, `docs/01 §10`):** `proposed → issued → opened → active → completed | revoked | expired
| failed`. Reading it: `proposed` (admitted spec) → `issued` (grant minted, route mounted, capsule spawned) →
`opened` (a handoff window is live, human can reach it) → `active` (no window open but the capsule lives and the
agent drives it). A window **closing** returns the session to `active` — it does **not** kill the capsule;
**only teardown** stops it. One capsule per session; multiple human pauses are **re-opened windows on the same
capsule**, not extra sessions (scenario-01's two handoffs).

### 1.3 Handoff window — the recipient-bound view onto a session (`see docs/05` handoff noun)

A window is the *act* of exposing the live capsule to the human; the agent references it by id and may open it
repeatedly. It is a lifecycle on `Session`, surfaced as its own noun to the agent.

```ts
type HandoffState = "open" | "completed" | "expired" | "cancelled";

interface HandoffWindow {
  id: `hand_${string}`;
  sessionId: Session["id"];
  recipient: RecipientRef;           // single-recipient caveat on the grant
  grantRef: Ref<"session">;          // recipient-bound, short TTL
  routeId: Route["id"];
  reason?: string;
  link: string;                      // delivered to the recipient via the channel
  expiresAt: Iso8601;
  state: HandoffState;
}
```
**Lifecycle:** `open → completed | expired | cancelled`. `completed` = the Completion service validated the
human's done-signal; `expired` = TTL elapsed (grant revoked, route unmounted, agent notified); `cancelled` =
closed early (grant revoked, WebSocket force-closed, route unmounted). Closing any window leaves the session
`active`.

### 1.4 Capability — the one authorization primitive (full contract in §2)

```ts
type CapabilityClass =
  | "agent-authority" | "task" | "session"
  | "secret-ref" | "channel-delegation" | "operator-discharge";

interface Capability {
  id: `cap_${string}`;
  cls: CapabilityClass;
  caveats: Caveat[];                 // attenuation only; see §2
  parentRef?: Capability["id"];      // null only for a root agent-authority
  // NB: NO signature field here — signing is an adapter concern (§2.4). The kernel
  // models identity + caveats + lineage; the bytes are minted/verified by the port.
}
```

### 1.5 Route — session-intent → public edge (`see route-controller.md`)

```ts
interface Route {
  id: `route_${string}`;
  path: string;                      // the public path the gateway exposes
  entrypointResourceId: string;      // provider-owned human-entrypoint resource
  client: HumanEntrypointClientBinding;
  transport: ReverseProxyTransportBinding; // upstream transport, not authorization
  boundGrantId: Capability["id"];    // a route binds to exactly one grant
}
```
**Lifecycle:** a route **exists only while its window is open**, is bound to exactly one grant, and is force-
unmounted on window close/grant revoke. Route authorization state (`path`, `boundGrantId`, recipient/session scope)
is separate from reverse-proxy transport state (`transport.upstream`, protocol, client asset). Reconciliation
converges programmed routes to Session truth (one of the few reconcilers the design keeps).

### 1.6 Completion — normalized done-signal (`see completion-service.md`)

```ts
interface CompletionEnvelope {
  status: string;                    // stable across detectors, e.g. "submitted" | "verified"
  result?: Record<string, unknown>;  // detector-shaped, validated against the contract
  next?: string;                     // optional hint for a multi-step chain
  detector: string;                  // which CompletionDetector fired
  at: Iso8601;
}
```
**Invariant:** an out-of-contract signal is **rejected, not trusted** (a spoofed "done" cannot advance the
flow). The envelope shape is stable regardless of detector. Detection is **mechanical**; *semantic* success
("did registration really work") is the agent's cognition over the connector, never decided here.

### 1.7 Audit event — the append-only trail (`see docs/01 §4, §6`)

```ts
interface AuditEvent {
  id: string;
  taskId: Task["id"];                // the trail is indexed by task
  sessionId?: Session["id"];
  handoffId?: HandoffWindow["id"];
  kind: string;                      // namespaced, e.g. "session.issued", "handoff.opened", "capability.revoked"
  actor: "agent" | "human" | "operator" | "system";
  detail: Record<string, unknown>;   // REDACTED on egress — never a raw secret
  at: Iso8601;
}
```
**Invariants:** append-only; indexed by task; **redacted on egress** (the redaction scanner that also guards
secret egress applies here). It is the evidentiary backbone for operator review and incident response.

---

## §2 · Capability contract — signing-independent (AC #2)

One primitive everywhere (`see docs/components/capability-service.md, docs/01 §6`). The kernel models the
**caveat algebra and the port**; the macaroon/HMAC realization is an **adapter** (so the library can change with
no core edit).

### 2.1 The six classes & their defining caveats

| Class | Minted from (parent) | Defining caveats | Purpose |
|---|---|---|---|
| `agent-authority` | root (none) | `authority-profile`, `allowed-ops` | the agent's root; every other cap attenuates from it |
| `task` | agent-authority | `task-id`, time | scopes a multi-step goal; revoke-root for its sessions |
| `session` (**grant**) | task | **`recipient`**, `ttl`, `scope` (path), `net-confine` | the recipient-bound window the gateway verifies |
| `secret-ref` | (system, agent-blind) | `secret-id`, `audience` | an opaque handle to a secret the agent never sees |
| `channel-delegation` | agent-authority/task | `channel`, `recipient` | authorizes an outbound send on a channel |
| `operator-discharge` | operator (out-of-band) | `single-use`, `purpose=enroll`, `ttl` | one-time authorization of a recipient enrollment |

### 2.2 Caveat model & attenuation (child ⊆ parent)

```ts
type Caveat =
  | { kind: "recipient";        recipient: RecipientRef }
  | { kind: "ttl";              notAfter: Iso8601 }
  | { kind: "scope";            path: string }
  | { kind: "net-confine";      cidrs: string[] }
  | { kind: "single-use";       nonce: string }
  | { kind: "authority-profile"; profile: string }
  | { kind: "allowed-ops";      ops: string[] }
  | { kind: "audience";         id: string }
  | { kind: "channel";          channel: string }
  | { kind: "purpose";          value: "enroll" | string };
```
**Attenuation invariant:** a child capability's caveat set is **only ever a tightening** of its parent's — a
child can never be broader (longer TTL, wider scope, different/added recipient, more ops). `attenuate()` may add
or narrow caveats; it can never widen. This is what lets the edge verify a whole chain by checking each link is
⊆ its parent.

### 2.3 Recipient-binding & stateless edge-verifiability (system-wide invariants)

- **Recipient-binding is a caveat, not a convention.** A grant carries a `recipient` caveat; the Access Gateway
  enforces it on **every request and every WS upgrade**. A forwarded link is useless in another's hands.
- **Stateless edge verification.** Verification is cryptographic with **no DB round-trip in the common path**;
  revocation rides a small replicated cache pushed from the Capability service. The kernel expresses this as a
  `verify()` that takes a *revocation snapshot*, never a live DB handle (§2.4).

### 2.4 The Capability port — `mint / attenuate / verify / revoke`

```ts
interface CapabilityPort {
  /** Mint a root or child capability of a class, with caveats. Signing is internal to the adapter. */
  mint(req: {
    cls: CapabilityClass;
    parentRef?: Capability["id"];
    caveats: Caveat[];
  }): Promise<{ capability: Capability; token: OpaqueToken }>;   // token = the bearer bytes (adapter-encoded)

  /** Derive a strictly-narrower child. MUST reject if the result is not ⊆ parent. */
  attenuate(parentToken: OpaqueToken, addedCaveats: Caveat[]): Promise<{ capability: Capability; token: OpaqueToken }>;

  /** Stateless verify against a pushed revocation snapshot — NO database round-trip in the common case. */
  verify(token: OpaqueToken, ctx: {
    now: Iso8601;
    recipient?: RecipientRef;        // the gateway supplies the presenter for the recipient caveat
    revocations: RevocationSnapshot; // the replicated cache, not a live store
  }): VerifyResult;

  /** Revoke a capability (and, by lineage, its descendants); push to verifiers. */
  revoke(id: Capability["id"]): Promise<void>;

  /** The current revocation snapshot to hand to edge verifiers. */
  revocationSnapshot(): RevocationSnapshot;
}

type VerifyResult =
  | { ok: true;  capability: Capability }
  | { ok: false; reason: ErrorCode };  // e.g. "auth.expired" | "auth.recipient_mismatch" | "auth.revoked"

type OpaqueToken = string & { readonly __brand: "cap-token" };  // the encoded bearer credential — opaque to core
interface RevocationSnapshot { has(id: Capability["id"]): boolean; version: string; }
```
**Guarantees:** `verify` is pure given its `ctx` (no I/O), so the edge stays stateless; `attenuate` is
**total-or-reject** on the ⊆-parent rule; `revoke` propagates to every verifier; the agent receives capability
**references/tokens, never raw signing material**. The `OpaqueToken` brand is the seam: the kernel never
inspects token bytes — only the adapter mints/parses them.

---

## §3 · AssemblySpec — versioned, schema-validated, offline-checkable (AC #3)

The artifact the agent authors: a K8s/Backstage-shaped object with a published JSON Schema, **a delta over a
template** (`see docs/04`). Two forms — the agent submits the thin form; admission resolves it to the full form.

```ts
interface AssemblySpec {
  apiVersion: "gla.dev/v1";          // versioned — bump on breaking change
  kind: "Assembly";
  metadata: { intent: string; task?: string };
  spec: {
    template: string;                // a registered+available CapsuleTemplate
    recipient: RecipientRef;         // passed through from the channel binding; narrow-only, never invented
    ttl?: Duration;
    launcher?:    PartRef;           // override only within compatibility
    entrypoints?: PartRef[];         // a capsule may expose several human surfaces
    connector?:   PartRef;
    workspace?:   PartRef;
    detectors?:   PartRef[];
    mounts?:      MountSpec[];        // host paths the agent can already reach (§3.1)
  };
}

interface PartRef {
  use: string;                       // names a registered + AVAILABLE provider by capability
  params?: Record<string, unknown>;  // validated against that provider's config_schema (§4)
}

/** ResolvedAssemblySpec = the full form after admission-mutate (template defaults merged in). Immutable on Session. */
type ResolvedAssemblySpec = AssemblySpec & { __resolved: true };
```

### 3.1 Mount shape (sufficient for offline validation)

```ts
interface MountSpec {
  host: string;                      // canonicalized at admission: symlinks resolved, absolute, no ".." escape
  target?: string;                   // default "/work/<basename>"
  mode?: "ro" | "rw";                // default "ro"
}
```
**Offline-validatable at `--dry-run`:** `use` must name a registered+available provider; `params` must conform
to its typed `config_schema`; each mount is checked against the operator allowed-set + catastrophic denylist
(Cedar, forbid-wins), its mode, target collisions, and the **launcher's declared mount capability** — all
without touching the host (runtime existence/readability is OS-enforced at spawn, as the agent's uid). Overriding
a template-**fixed** field (isolation tier, `privileged`, namespaces) is a **reject**, not a silent override.
The agent never produces the resolved spec — admission owns resolution (mutate-merge → validate, `docs/04 §4`).

---

## §4 · Typed config_schema vocabulary (AC #4)

The single mechanism that makes authoring **allowlist-by-construction** (`see docs/02 §3.1, docs/04 §3`): a
provider declares the *typed set of options the agent may set*, and nothing off-schema is expressible. Validation
runs through the kernel's Ajv-backed JSON Schema boundary **offline and early** (Terraform's provider-schema
model). The schema is itself a conservative JSON Schema profile: the ingester checks it before it can constrain
provider config, and runtime/factory/profile/template config all reuse the same `validateConfig` boundary.

```ts
type ConfigSchemaType =
  | "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

interface ConfigSchemaNode {
  type?: ConfigSchemaType | ConfigSchemaType[];
  properties?: Record<string, ConfigSchemaNode>;
  required?: string[];
  additionalProperties?: false;
  items?: ConfigSchemaNode;
  enum?: unknown[];
  const?: unknown;
  minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; pattern?: string;
  minItems?: number; maxItems?: number;
  dependencies?: Record<string, string[]>;
  allOf?: ConfigSchemaNode[]; anyOf?: ConfigSchemaNode[];
  oneOf?: ConfigSchemaNode[]; not?: ConfigSchemaNode;
  if?: ConfigSchemaNode; then?: ConfigSchemaNode; else?: ConfigSchemaNode;
  default?: unknown;                 // graph/defaulting metadata, not validator mutation
  "x-gla-sensitive"?: boolean;       // redaction metadata, never a literal secret
}

interface ConfigSchema extends ConfigSchemaNode {
  type: "object";
  additionalProperties: false;
}
```
Ajv is configured fail-closed for this boundary: all discoverable errors are collected, unknown fields reject through
`additionalProperties:false`, strict schema validation is on, and defaults/coercion/unknown-field removal are disabled
so validation never mutates caller input. Sensitive metadata is diagnostic metadata only: invalid values and sensitive
schema literals are not emitted in field-level defects.

**Guarantees:** the trusted provider/template author draws the line once (which native knobs become options and
their bounds); the untrusted agent only sets conforming values; off-menu input is rejected offline at admission.
The same schema is surfaced three equivalent ways — `-f` file, `--set path=value`, and `gla schema`
introspection — so a provider costs *a schema*, not a bespoke command set, and there is nothing to keep in sync.

---

## §5 · Error & exit-code taxonomy (AC #5)

A **contract other programs branch on** (`see docs/05 §4–§5`). Errors go to stderr as JSON; the coarse branch is
the exit code, the rich signal is the namespaced `error.code`, and `skill` is the agent's recovery entry point —
**facts, never prose advice**.

```ts
interface GlaError {
  code: ErrorCode;                   // stable + namespaced
  message: string;
  detail?: Record<string, unknown>;
  skill: string;                     // the skill to load to reason about recovery
  retryable: boolean;
}
```

### 5.1 Error-code families (namespaces)

| Namespace | Meaning | Representative codes |
|---|---|---|
| `usage.*` | malformed invocation | `usage.invalid_flag`, `usage.bad_argument` |
| `policy.*` | Cedar/admission rejection (assembly not allowed) | `policy.denied`, `policy.detector_missing` |
| `auth.*` | authN/authZ — insufficient/invalid capability | `auth.insufficient`, `auth.expired`, `auth.revoked`, `auth.recipient_mismatch` |
| `catalog.*` | unknown / unavailable catalog entity | `catalog.unknown`, `catalog.unavailable` |
| `state.*` | invalid state transition / conflict | `state.conflict`, `state.no_live_capsule` |
| `dependency.*` | a dependency/provider cannot provision | `dependency.unavailable`, `dependency.probe_failed` |
| `mount.*` | host-mount rejection | `mount.denied`, `mount.not_found`, `mount.conflict`, `mount.unsupported` |

### 5.2 Exit-code map (stable)

| Exit | Meaning | Mapped error namespaces |
|---|---|---|
| 0 | success | — |
| 1 | unexpected / internal | (uncaught) |
| 2 | usage — invalid flags/args | `usage.*` |
| 3 | admission / policy rejection | `policy.*`, **`mount.denied`** |
| 4 | authN/authZ failure (insufficient capability) | `auth.*` |
| 5 | not found | `catalog.unknown`, `state`-not-found, **`mount.not_found`** |
| 6 | timeout / window expired | (handoff wait timeout, `auth.expired` at wait) |
| 7 | conflict / invalid state transition | `state.conflict`, **`mount.conflict`** |
| 8 | dependency / provider unavailable | `dependency.*`, `catalog.unavailable`, **`mount.unsupported`** |

The **mount namespace mapping is load-bearing** (AC #5 calls it out): `denied → 3`, `not_found → 5`,
`conflict → 7`, `unsupported → 8`. These hold identically on the CLI exit code and the MCP error payload
(parity).

---

## §6 · Module ports — method shape + guarantees, no concrete adapter (AC #6)

Every seam the core depends on is a **kernel interface**; the concrete adapter is injected at `app` and **never
named in the kernel** (`see docs/02`, baseline.md §1). Each guarantee column is the contract a contract-test
enforces.

```ts
// ── Authorization / enforcement family ────────────────────────────────
interface PolicyPort {                 // Cedar is one adapter; forbid-wins, deterministic, order-independent
  evaluate(req: { principal: Capability; action: string; resource: ResolvedAssemblySpec; context: PolicyContext })
    : { decision: "permit" | "forbid"; reasons: ErrorCode[] };
}                                       // GUARANTEE: pure, total, order-independent; forbid always wins.

interface AuthProviderPort {           // WebAuthn / authentik / OIDC are adapters
  beginEnrollment(userId: UserIdentity["id"], discharge: OpaqueToken): Promise<EnrollmentChallenge>;
  finishEnrollment(userId: UserIdentity["id"], assertion: unknown): Promise<{ credentialId: string; authStrength: AuthStrength; assurance?: AuthAssuranceEvidence }>;
  challenge(userId: UserIdentity["id"]): Promise<AuthChallenge>;
  verifyAssertion(userId: UserIdentity["id"], assertion: unknown): Promise<{ ok: boolean; authStrength: AuthStrength; assurance?: AuthAssuranceEvidence }>;
}                                       // GUARANTEE: reports FACTS (ok + auth_strength + assurance evidence), never an access decision. `authStrength` is compatibility; phishing-resistant enforcement needs explicit assurance evidence.

interface SecretStorePort {            // Vault/OpenBao/file are adapters; agent-blind
  put(value: SecretValue, audience: string): Promise<Ref<"secret-ref">>;   // returns a ref, never echoes the value
  injectInto(ref: Ref<"secret-ref">, target: InjectionTarget): Promise<void>; // tmpfs / boundary injection
}                                       // GUARANTEE: raw value never crosses into agent space; ref is opaque.

// ── Worker / capsule family ───────────────────────────────────────────
interface LauncherPort {               // local-process (T2 default) / docker (T4) are adapters
  readonly tier: "none" | "local-process" | "systemd-user" | "rootless" | "docker" | "remote-worker";
  readonly mountCapability: { file: boolean; directory: boolean; modes: Array<"ro"|"rw">; };  // none ⇒ remote
  spawn(spec: ResolvedAssemblySpec, asUid: number): Promise<RuntimeHandle>;  // runs as the AGENT's uid, priv-esc off
  health(h: RuntimeHandle): Promise<"up" | "down">;
  stop(h: RuntimeHandle): Promise<void>;
}                                       // GUARANTEE: never grants a privileged path; DAC fails closed on mounts.

interface WorkspacePort {              // browser-profile-temp / staged-copy / persistent are adapters
  realize(strategy: PartRef, mounts: MountSpec[], asUid: number): Promise<WorkspaceHandle>;
  reap(h: WorkspaceHandle): Promise<void>;   // destroys OWN ephemeral materials only; host mounts survive
}

interface RuntimeEndpointDescriptor {
  resourceId: string;                  // stable provider-owned identity; never a raw upstream URL
  family: "agent-connector" | "human-entrypoint" | string;
  provider: string;
  transport: "websocket" | "http" | "tcp" | "stdio" | "file" | string;
  address?: string;                    // adapter-owned locator; core treats as opaque transport data
  client?: { kind: string; ref?: string; bootstrap?: Record<string, unknown> };
  metadata?: Record<string, unknown>;  // non-secret diagnostics only
}

interface RuntimeDescriptor {
  launchMode?: string;                 // diagnostic hint, not an authorization input
  endpoints?: RuntimeEndpointDescriptor[];
  [launcherPrivate: string]: unknown;  // pid/ports/process data remain launcher-private
}

interface HumanEntrypointBinding {
  resourceId: string;                  // provider-owned identity, stable for lifecycle/teardown
  provider: string;
  client: { kind: string; ref?: string; bootstrap?: Record<string, unknown> };
  transport: { kind: "reverse-proxy"; protocol: string; upstream: string };
}

interface HumanEntrypointPort {
  open(h: RuntimeHandle): Promise<HumanEntrypointBinding>;
}                                       // GUARANTEE: agent-blind input path — human keystrokes reach the site, not the agent.

interface AgentConnector {
  type: string;                         // adapter-owned public connector DTO type
  resourceId: string;                   // provider-owned identity for bind/unbind/reuse/teardown
  provider?: string;
  secret_ref?: Ref<"secret-ref">;       // capability reference, never raw secret
  [providerField: string]: unknown;     // protocol-specific public fields stay adapter-owned
}

interface AgentConnectorPort {
  attach(h: RuntimeHandle): Promise<AgentConnector>;   // printed as data, driven off-gla
}

interface CompletionDetectorPort {     // url-watcher / user-done / exit-code / dom-watcher are adapters
  readonly contract: ConfigSchema;     // what params it accepts (e.g. complete_on)
  watch(h: RuntimeHandle, params: Record<string, unknown>): AsyncIterable<RawCompletionSignal>;
}                                       // GUARANTEE: emits a raw signal; the Completion service validates it vs this contract.

// ── Edge family ───────────────────────────────────────────────────────
interface ChannelPort {                // telegram (default) / cli (fallback) / slack / email are adapters
  deliver(recipient: RecipientRef, link: string, delegation: OpaqueToken): Promise<void>;  // verifies channel-delegation
  receive(): AsyncIterable<{ recipient: RecipientRef; message: string; chatContext: unknown }>;
}                                       // GUARANTEE: delivers only to the bound recipient; never widens the binding.

interface CatalogPort {                // the registry read interface — Store→Ingester→Index
  list(filter?: { kind?: string; available?: boolean }): CatalogEntity[];
  show(name: string): CatalogEntity | undefined;
  resolveTemplate(id: string): TemplateDescriptor | undefined;  // required parts + open-param schema + binding status
}                                       // GUARANTEE: availability is SYSTEM-DERIVED, never author-declared.
```
**No concrete dependency name appears in any port** (it is `PolicyPort`, not `CedarPort`; `LauncherPort`, not
`DockerPort`). The kernel depends on the *shape*; `app` wires the adapter. This is exactly what makes horizontal
extension change no core code (`baseline.md §6`).

Auth providers also project verified provider evidence into the common auth-assurance contract before an
enforcement point evaluates sufficiency. `AuthStrength` remains the stable compatibility fact on the port
result; provider vocabulary such as `amr`, `acr`, factor, source, or future provider claims stays adapter-local
and diagnostic-only.

---

## §7 · Recipient-identity & enrollment model (AC #7)

The identity contract that makes a recipient **establishable before any handoff verifies them** (`see
docs/components/identity-and-auth.md`). Authentication ≠ authorization, never conflated; the verifier reports
*facts*, not decisions.

```ts
type AuthStrength = "none" | "password" | "webauthn";

type AuthAssuranceLevel = "none" | "password" | "phishing-resistant";
type AuthAssuranceProfile = "phishing-resistant" | "password-permitted";

interface AuthAssuranceEvidence {
  authStrength: AuthStrength;          // compatibility fact
  level: AuthAssuranceLevel;           // provider-neutral assurance tier
  methodResolvable?: boolean;          // false when a valid token degraded to the safe floor
  userPresent?: boolean;               // local authenticator/user interaction was observed
  userVerified?: boolean;              // user was verified by PIN/biometric/equivalent provider proof
  recipientBound?: boolean;            // proof was bound to the intended recipient/RP/audience
  replayResistant?: boolean;           // challenge/nonce/state/counter replay checks passed
  diagnostics?: string[];              // redacted downgrade/fail-closed reasons
  providerEvidence?: Record<string, unknown>; // diagnostic only; never used directly by the gateway
}

interface AuthAssurancePolicy {
  profile: AuthAssuranceProfile;       // stable deployment surface
  minimumLevel: "password" | "phishing-resistant";
}

interface UserIdentity {
  id: string;                          // stable across channels
  enrolledCredentialId?: string;       // set once enrollment completes (a passkey, or a password record)
}

interface RecipientBinding {
  recipient: RecipientRef;             // channel-specific, e.g. "tg:user:123"
  userId: UserIdentity["id"];
  provenance: string;                  // which channel established it
  authStrength: AuthStrength;          // current strength of the proof
}

interface IdentityPort {
  bind(recipient: RecipientRef, ctx: { channel: string }): Promise<RecipientBinding>;  // narrow-only, never widened
  /** One-time, operator-initiated enrollment, authorized by a single-use operator-discharge grant. */
  enroll(recipient: RecipientRef, discharge: OpaqueToken): Promise<{ binding: RecipientBinding; authStrength: AuthStrength; assurance?: AuthAssuranceEvidence }>;
  /** Verify a recipient at the edge; returns FACTS, not an allow/deny. */
  verify(recipient: RecipientRef, assertion: unknown): Promise<{ ok: boolean; authStrength: AuthStrength; assurance?: AuthAssuranceEvidence; userId: UserIdentity["id"] }>;
}
```
**Policy profiles:** unset policy resolves to `phishing-resistant`, which demands passkey/phishing-resistant
assurance with explicit user-verification, recipient-binding, and replay-resistant evidence. A legacy
`authStrength: "webauthn"` string without an `AuthAssuranceEvidence` object is not enough for that profile.
`password-permitted` is the explicit profile that admits password-grade evidence. Unknown profile
values are usage errors with stable diagnostics; they never silently fall back to a weaker policy.

**Invariants (frozen, `identity-and-auth.md`):** a recipient can be verified **only if previously enrolled**;
**enrollment is one-time and operator-initiated**, authorized by a single-use `operator-discharge` grant the
gateway verifies like any other — it is **never a per-task or per-handoff step**. Recipient-binding originates
from the channel and is **only ever narrowed**. The agent **never enrolls recipients and never sees their
credentials** (enrollment is not on the agent's CLI surface, `docs/05 §3`). **Agent authentication is
profile-gated and deferred in the MVP** (replaced by verified Bridge network isolation — a doctor probe;
`baseline.md §5`).

---

## §8 · Kernel build implementation plan (AC #8 — feeds GLA-004)

Ordered so **contracts precede every dependent**. GLA-003 lays the workspace + quality gate + empty packages
with the boundary lint; GLA-004 fills `kernel` then the core aggregates against these contracts (no concrete
adapter — `GLA-004 AC#7`).

| Step | Build | Depends on | Why this order |
|---|---|---|---|
| K0 | nominal aliases + branded types (`Iso8601`, `Duration`, `Ref<>`, `OpaqueToken`, id-brands) | — | everything references them |
| K1 | **error taxonomy** (`GlaError`, `ErrorCode` union, exit-code map) | K0 | ports/entities return these; tests assert on them |
| K2 | **Caveat algebra** + attenuation predicate (`child ⊆ parent`) | K0 | the heart of §2; unit-testable in isolation |
| K3 | **Capability entity + `CapabilityPort`** (signing-agnostic) | K1,K2 | task/session/grant all mint from it |
| K4 | **config_schema vocabulary** (`ConfigSchema`, JSON-Schema validity check) | K1 | AssemblySpec params + catalog ingest need it |
| K5 | **AssemblySpec + Mount + Resolved** types + published JSON Schema | K4 | session.spec is this; admission validates it |
| K6 | **core entity types & state machines** (Task, Session, HandoffWindow, Route, CompletionEnvelope, AuditEvent) | K1,K3,K5 | the aggregates; transitions are pure functions |
| K7 | **port interfaces** (§6) + `Identity`/enrollment types (§7) | K1,K3,K4,K5 | the seams; no bodies, no adapters |
| K8 | **state-transition functions** (pure reducers per lifecycle) + their unit tests | K6 | provable without any adapter — kernel stays adapter-free |
| K9 | publish the JSON Schemas + `gla schema` read-model fixtures | K4,K5,K7 | the agent-facing introspection contract |

**Sequencing rule:** no step imports anything from a later step, and **no `kernel` step imports any
`adapters/**`** — the boundary lint (`baseline.md §1`) fails the build otherwise. Aggregates (task/session/…)
are separate packages built after K8, each importing only `kernel`.

---

## §9 · External dependencies the *kernel itself* needs (AC #9)

The kernel is **pure domain + ports**; it deliberately pulls in **only traditional, in-tree, dev-time
libraries** and **no host-touching dependency** — so **none of GLA-007–011 is required by the kernel**. (Those
wpm packages are needed by the *adapters/worker/runtime*, planned in `dependency-strategy.md` / GLA-005, not by
the kernel.)

| Dependency | Role in the kernel | Classification | Maps to |
|---|---|---|---|
| TypeScript / Node 22 | the language/runtime | traditional, in-tree (dev) | toolchain (GLA-003) |
| a JSON-Schema validator (e.g. Ajv-class) | validate AssemblySpec + that each `config_schema` is valid JSON Schema | traditional, in-tree library | bundled in `kernel`/`assembly` |
| Vitest | contract/unit tests of the algebra & reducers | traditional, in-tree (dev) | quality gate (GLA-003) |
| Biome | lint incl. the import-boundary rule | traditional, in-tree (dev) | quality gate (GLA-003) |

**Deliberately *not* a kernel dependency** (they live behind ports, in adapters, and are classified in GLA-005):
the macaroon/HMAC signer (capability adapter), Cedar (`policy-cedar`, GLA-006), Playwright/Chromium
(`launcher-process`, browser-runtime **GLA-007**), noVNC/websockify/Xvfb (human-view **GLA-008**), the isolation
runtime (**GLA-009**), Caddy (edge-proxy **GLA-010**), `@simplewebauthn/server`/authentik (identity **GLA-011**),
Telegram client (`channel-telegram`). **The kernel names none of them** — that is the whole point of §6.

---

## §10 · Contract invariants (the non-negotiables this doc fixes)

1. The **kernel imports no concrete adapter and no host-touching dependency** (`GLA-004 AC#7`).
2. **Capability is signing-independent**: the kernel models caveats + lineage + the port; tokens are opaque
   bytes minted/verified by the adapter.
3. **Attenuation only**: every child capability is ⊆ its parent; `attenuate()` is reject-or-narrow.
4. **`verify()` is pure** given a revocation snapshot — the edge stays stateless.
5. **AssemblySpec is offline-validatable** (`--dry-run`): registered+available `use`, `config_schema`-conformant
   `params`, mount allowed-set/denylist/mode/launcher-capability — no host touch.
6. **Every value the agent sets conforms to a typed `config_schema`**; off-schema is rejected at admission.
7. **Error codes are stable + namespaced; exit codes are the contract** — incl. the mount namespace map
   (`denied→3, not_found→5, conflict→7, unsupported→8`).
8. **A recipient is verifiable only if enrolled**; enrollment is one-time, operator-initiated, `operator-
   discharge`-authorized, never a handoff step.
9. **Spec is immutable after admission**; session/handoff/route lifecycles are exactly as in §1.
10. **Surface parity**: every contract holds identically on CLI and MCP (`docs/05`).
