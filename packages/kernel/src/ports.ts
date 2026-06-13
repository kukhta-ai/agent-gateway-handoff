// K7 — module port interfaces (kernel-contracts.md §6) + identity/enrollment types (§7).
// Every seam the core depends on is a kernel INTERFACE; the concrete adapter is injected at
// `app` and NEVER named here (invariant 1). No bodies, no adapters, no concrete dependency name
// (it is `PolicyPort`, not `CedarPort`). These are the contracts the contract-tests enforce.

import type { MountSpec, PartRef, ResolvedAssemblySpec } from "./assembly.js";
import type { AuthAssuranceEvidence } from "./auth-assurance.js";
import type { Iso8601, OpaqueToken, RecipientRef, Ref } from "./brands.js";
import type { Capability } from "./capability.js";
import type { ConfigSchema } from "./config-schema.js";
import type { CompletionEnvelope, RuntimeHandle } from "./entities.js";
import type { ErrorCode } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// §7 · Recipient-identity & enrollment model
// ─────────────────────────────────────────────────────────────────────────────

/** The strength of a recipient's current proof (§7). Authentication ≠ authorization. */
export type AuthStrength = "none" | "password" | "webauthn";

/** A provider-reported auth fact plus its provider-neutral assurance projection. */
export interface AuthAssuranceFact {
  authStrength: AuthStrength;
  /**
   * Provider-neutral assurance evidence. Legacy providers may omit this; consumers must then derive the
   * compatibility projection from `authStrength` rather than assuming stronger evidence.
   */
  assurance?: AuthAssuranceEvidence;
}

/** The result of a provider enrollment ceremony. */
export interface AuthProviderEnrollmentResult extends AuthAssuranceFact {
  credentialId: string;
}

/** The result of a provider verification ceremony. Reports facts, not an allow/deny decision. */
export interface AuthProviderVerificationResult extends AuthAssuranceFact {
  ok: boolean;
}

/** The identity-level verification fact returned at the recipient boundary. */
export interface IdentityVerificationResult extends AuthProviderVerificationResult {
  userId: UserIdentity["id"];
}

/** A stable user identity across channels (§7). */
export interface UserIdentity {
  id: string;
  /** Set once enrollment completes (a passkey, or a password record). */
  enrolledCredentialId?: string;
}

/** A channel-established binding from a recipient ref to a user identity (§7). Narrow-only. */
export interface RecipientBinding {
  /** Channel-specific, e.g. "tg:user:123". */
  recipient: RecipientRef;
  userId: UserIdentity["id"];
  /** Which channel established it. */
  provenance: string;
  /** Current strength of the proof. */
  authStrength: AuthStrength;
}

/** Opaque enrollment/auth challenge payloads (adapter-shaped). */
export type EnrollmentChallenge = unknown;
export type AuthChallenge = unknown;

/**
 * Recipient identity port (§7). A recipient is verifiable ONLY if previously enrolled;
 * enrollment is one-time, operator-initiated, authorized by a single-use `operator-discharge`
 * grant — never a per-task/per-handoff step (invariant 8). `verify` reports FACTS, not a
 * decision.
 */
export interface IdentityPort {
  /** Narrow-only; never widened. */
  bind(recipient: RecipientRef, ctx: { channel: string }): Promise<RecipientBinding>;
  /** One-time, operator-initiated enrollment, authorized by a single-use operator-discharge grant. */
  enroll(
    recipient: RecipientRef,
    discharge: OpaqueToken,
  ): Promise<{ binding: RecipientBinding } & AuthAssuranceFact>;
  /** Verify a recipient at the edge; returns FACTS, not an allow/deny. */
  verify(recipient: RecipientRef, assertion: unknown): Promise<IdentityVerificationResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 · Authorization / enforcement family
// ─────────────────────────────────────────────────────────────────────────────

/** Context Cedar/policy evaluates against (kept opaque to the kernel). */
export type PolicyContext = Record<string, unknown>;

/**
 * Policy decision port (§6). Cedar is ONE adapter; the guarantee is pure, total,
 * order-independent — and **forbid always wins**.
 */
export interface PolicyPort {
  evaluate(req: {
    principal: Capability;
    action: string;
    resource: ResolvedAssemblySpec;
    context: PolicyContext;
  }): { decision: "permit" | "forbid"; reasons: ErrorCode[] };
}

/**
 * Auth-provider port (§6). WebAuthn / authentik / OIDC are adapters. Reports FACTS (ok +
 * auth_strength), NEVER an access decision.
 */
export interface AuthProviderPort {
  beginEnrollment(userId: UserIdentity["id"], discharge: OpaqueToken): Promise<EnrollmentChallenge>;
  finishEnrollment(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderEnrollmentResult>;
  challenge(userId: UserIdentity["id"]): Promise<AuthChallenge>;
  verifyAssertion(
    userId: UserIdentity["id"],
    assertion: unknown,
  ): Promise<AuthProviderVerificationResult>;
}

/** Opaque secret value + injection target (agent-blind; never inspected by the kernel). */
export type SecretValue = unknown;
export type InjectionTarget = unknown;

/**
 * Secret-store port (§6). Vault/OpenBao/file are adapters; agent-blind. The raw value NEVER
 * crosses into agent space; the returned ref is opaque.
 */
export interface SecretStorePort {
  put(value: SecretValue, audience: string): Promise<Ref<"secret-ref">>;
  injectInto(ref: Ref<"secret-ref">, target: InjectionTarget): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 · Worker / capsule family
// ─────────────────────────────────────────────────────────────────────────────

/** A handle to a realized workspace (adapter-owned). */
export type WorkspaceHandle = Ref<"workspace">;

/** A launcher's declared mount capability (§6). `none` ⇒ a remote launcher that shares no host. */
export interface MountCapability {
  file: boolean;
  directory: boolean;
  modes: Array<"ro" | "rw">;
}

/**
 * Launcher port (§6). local-process (T2 default) / docker (T4) are adapters. Runs as the AGENT's
 * uid with priv-esc OFF; NEVER grants a privileged path; DAC fails closed on mounts.
 */
export interface LauncherPort {
  readonly tier:
    | "none"
    | "local-process"
    | "systemd-user"
    | "rootless"
    | "docker"
    | "remote-worker";
  readonly mountCapability: MountCapability;
  spawn(spec: ResolvedAssemblySpec, asUid: number): Promise<RuntimeHandle>;
  health(h: RuntimeHandle): Promise<"up" | "down">;
  stop(h: RuntimeHandle): Promise<void>;
}

/**
 * Workspace port (§6). browser-profile-temp / staged-copy / persistent are adapters. `reap`
 * destroys OWN ephemeral materials only; host mounts survive.
 */
export interface WorkspacePort {
  realize(strategy: PartRef, mounts: MountSpec[], asUid: number): Promise<WorkspaceHandle>;
  reap(h: WorkspaceHandle): Promise<void>;
}

/**
 * Human-entrypoint port (§6). noVNC / form / doc-editor are adapters. Agent-blind input path —
 * human keystrokes reach the site, not the agent.
 */
export interface HumanEntrypointPort {
  open(h: RuntimeHandle): Promise<{ internalEndpoint: string }>;
}

/** The agent's handle to drive the capsule (printed as data, driven off-gla). */
export interface AgentConnector {
  type: string;
  cdp_url?: string;
  path?: string;
  secret_ref?: Ref<"secret-ref">;
}

/** Agent-connector port (§6). CDP / fs-path / secret-ref are adapters. */
export interface AgentConnectorPort {
  attach(h: RuntimeHandle): Promise<AgentConnector>;
}

/** A raw, not-yet-validated completion signal from a detector. */
export interface RawCompletionSignal {
  status: string;
  result?: Record<string, unknown>;
  detector: string;
  at: Iso8601;
}

/**
 * Completion-detector port (§6). url-watcher / user-done / exit-code / dom-watcher are adapters.
 * Emits a RAW signal; the Completion service validates it vs this `contract`.
 */
export interface CompletionDetectorPort {
  readonly contract: ConfigSchema;
  watch(h: RuntimeHandle, params: Record<string, unknown>): AsyncIterable<RawCompletionSignal>;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 · Edge family
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Channel port (§6). telegram (default) / cli (fallback) / slack / email are adapters. Delivers
 * ONLY to the bound recipient; never widens the binding (verifies channel-delegation).
 */
export interface ChannelPort {
  deliver(recipient: RecipientRef, link: string, delegation: OpaqueToken): Promise<void>;
  receive(): AsyncIterable<{ recipient: RecipientRef; message: string; chatContext: unknown }>;
}

/** A catalog entity as the registry exposes it (shape kept open; catalog package refines it). */
export interface CatalogEntity {
  name: string;
  kind: string;
  available: boolean;
  [k: string]: unknown;
}

/** A template descriptor: required parts + open-param schema + binding status (§6). */
export interface TemplateDescriptor {
  id: string;
  requiredParts: string[];
  openParams: ConfigSchema;
  available: boolean;
  [k: string]: unknown;
}

/**
 * Catalog read port (§6) — Store→Ingester→Index. Availability is SYSTEM-DERIVED, never
 * author-declared.
 */
export interface CatalogPort {
  list(filter?: { kind?: string; available?: boolean }): CatalogEntity[];
  show(name: string): CatalogEntity | undefined;
  resolveTemplate(id: string): TemplateDescriptor | undefined;
}

// Re-export the completion envelope type for port consumers that normalize signals.
export type { CompletionEnvelope };
