// K6 — core entity types (kernel-contracts.md §1). Pure domain shapes; their state machines
// (the legal transitions + the typed reducers) live in `state-machines.ts` (K8). No I/O, no
// adapter. Each entity's lifecycle is documented inline and enforced there.

import type { ResolvedAssemblySpec } from "./assembly.js";
import type {
  CapabilityId,
  HandoffId,
  Iso8601,
  RecipientRef,
  RouteId,
  SessionId,
  TaskId,
} from "./brands.js";
import type { Ref } from "./brands.js";
import type { HumanEntrypointClientBinding, ReverseProxyTransportBinding } from "./ports.js";

// ─────────────────────────────────────────────────────────────────────────────
// §1.1 Task — the multi-step goal
// ─────────────────────────────────────────────────────────────────────────────

/** Task lifecycle states (§1.1). `completed`/`revoked`/`failed` semantics in `state-machines.ts`. */
export type TaskState = "active" | "completed" | "revoked" | "failed";

/** The multi-step goal aggregate (§1.1, task-service.md). Its state is the aggregate of its sessions. */
export interface Task {
  id: TaskId;
  /** Opaque; bound from the channel, narrow-only. */
  recipient?: RecipientRef;
  /** Opaque to the system — agent cognition, never parsed. */
  intentLabel?: string;
  state: TaskState;
  /** Ordered chain of session ids. */
  sessions: SessionId[];
  stepCounters: { opened: number; completed: number };
  /** Parent = agent-authority. */
  taskCapabilityRef: Ref<"task">;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  /** True when auto-created by `session create` without `--task`. */
  implicit: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.2 Session — the per-handoff unit / one capsule's lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** Session lifecycle states (§1.2, canonical `docs/01 §10`). */
export type SessionState =
  | "proposed"
  | "issued"
  | "opened"
  | "active"
  | "completed"
  | "revoked"
  | "expired"
  | "failed";

/** An opaque handle to the live capsule from the worker plane. */
export type RuntimeHandle = Ref<"runtime">;

/** One provider selected for a capsule part after admission resolves defaults and overrides. */
export interface ResolvedCapsuleProviderPlan {
  role: string;
  providerId: string;
  config: Record<string, unknown>;
  available: boolean;
  availability?: string;
  evidenceRequirements: unknown[];
  diagnostics: unknown[];
}

/** The admission-resolved capsule provider plan pinned on a Session. */
export interface ResolvedCapsulePlan {
  template: string;
  providers: ResolvedCapsuleProviderPlan[];
}

/** The Session aggregate (§1.2, session-service.md). `spec` is IMMUTABLE after admission. */
export interface Session {
  id: SessionId;
  taskId: TaskId;
  stepName?: string;
  /** IMMUTABLE after admission (§3, invariant 9). */
  spec: ResolvedAssemblySpec;
  /** IMMUTABLE after admission: resolved capsule provider ids, config, evidence, and diagnostics. */
  capsulePlan?: ResolvedCapsulePlan;
  state: SessionState;
  /** The current window's recipient-bound grant, if a window is open. */
  grantTokenRef?: Ref<"session">;
  /** Programmed while a window is open. */
  route?: Route;
  /** The live capsule handle from the worker plane. */
  runtime?: RuntimeHandle;
  recipient?: RecipientRef;
  /** Last validated completion. */
  completion?: CompletionEnvelope;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  expiresAt?: Iso8601;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.3 Handoff window — the recipient-bound view onto a session
// ─────────────────────────────────────────────────────────────────────────────

/** Handoff window lifecycle states (§1.3). */
export type HandoffState = "open" | "completed" | "expired" | "cancelled";

/** A recipient-bound window onto a live session (§1.3, docs/05 handoff noun). */
export interface HandoffWindow {
  id: HandoffId;
  sessionId: SessionId;
  /** Single-recipient caveat on the grant. */
  recipient: RecipientRef;
  /** Recipient-bound, short TTL. */
  grantRef: Ref<"session">;
  routeId: RouteId;
  reason?: string;
  /** Delivered to the recipient via the channel. */
  link: string;
  expiresAt: Iso8601;
  state: HandoffState;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.5 Route — session-intent → public edge
// ─────────────────────────────────────────────────────────────────────────────

/** A programmed gateway route (§1.5, route-controller.md). Exists only while its window is open. */
export interface Route {
  id: RouteId;
  /** The public path the gateway exposes. */
  path: string;
  /** Provider-neutral entrypoint resource this route exposes while the grant is live. */
  entrypointResourceId: string;
  /** Browser client requirements for this route's human-entrypoint provider. */
  client: HumanEntrypointClientBinding;
  /** Reverse-proxy transport binding, separated from grant/recipient authorization. */
  transport: ReverseProxyTransportBinding;
  /** A route binds to exactly one grant. */
  boundGrantId: CapabilityId;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.6 Completion — normalized done-signal
// ─────────────────────────────────────────────────────────────────────────────

/** A normalized done-signal envelope (§1.6, completion-service.md). Stable across detectors. */
export interface CompletionEnvelope {
  /** Stable across detectors, e.g. "submitted" | "verified". */
  status: string;
  /** Detector-shaped, validated against the contract. */
  result?: Record<string, unknown>;
  /** Optional hint for a multi-step chain. */
  next?: string;
  /** Which CompletionDetector fired. */
  detector: string;
  at: Iso8601;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.7 Audit event — the append-only trail
// ─────────────────────────────────────────────────────────────────────────────

/** Who acted (§1.7). */
export type AuditActor = "agent" | "human" | "operator" | "system";

/** An append-only audit record (§1.7, docs/01 §4/§6). Indexed by task; REDACTED on egress. */
export interface AuditEvent {
  id: string;
  /** The trail is indexed by task. */
  taskId: TaskId;
  sessionId?: SessionId;
  handoffId?: HandoffId;
  /** Namespaced, e.g. "session.issued", "handoff.opened", "capability.revoked". */
  kind: string;
  actor: AuditActor;
  /** REDACTED on egress — never a raw secret. */
  detail: Record<string, unknown>;
  at: Iso8601;
}
