// K-runtime — the RuntimeHandle structured-payload convention (kernel-contracts.md §6, capsule.md).
// A `RuntimeHandle` (entities.ts) is an opaque `Ref<"runtime">` the worker plane hands back from the
// launcher. Its internal process bookkeeping is a launcher concern, but adapter families still need a
// shared way to discover runtime-owned resources without importing each other. The kernel therefore owns
// only the neutral descriptor vocabulary: resource id, family, provider id, transport, and optional
// client metadata. Concrete protocols and provider-specific payload fields remain adapter-owned.

import type { ResolvedAssemblySpec } from "./assembly.js";
import type { Ref } from "./brands.js";
import type { RuntimeHandle } from "./entities.js";

/** A realized-workspace handle (kept structural — the worker/workspace/launcher agree on it). */
export type WorkspaceHandleRef = Ref<"workspace">;

/** A runtime-owned resource family that an adapter can attach to or expose. */
export type RuntimeEndpointFamily = "agent-connector" | "human-entrypoint" | (string & {});

/** A transport class. Provider adapters refine the exact protocol semantics locally. */
export type RuntimeEndpointTransport =
  | "websocket"
  | "http"
  | "tcp"
  | "stdio"
  | "file"
  | (string & {});

/** Browser-facing client requirements for a human-entrypoint provider. */
export interface RuntimeClientDescriptor {
  /** Provider-neutral client asset kind, e.g. a gateway page, a provider asset, or an external URL. */
  kind: string;
  /** Optional same-origin path, package asset id, or provider-local locator. */
  ref?: string;
  /** Non-secret bootstrap data needed by the browser client. */
  bootstrap?: Record<string, unknown>;
}

/** A runtime endpoint/resource descriptor shared across launcher, connector, and entrypoint providers. */
export interface RuntimeEndpointDescriptor {
  /** Stable, provider-owned resource identity. Raw transport URLs are not resource identities. */
  resourceId: string;
  /** Which provider family consumes this descriptor. */
  family: RuntimeEndpointFamily;
  /** Provider id as registered in the operator-installed provider catalog. */
  provider: string;
  /** Transport class for the resource. */
  transport: RuntimeEndpointTransport;
  /** Adapter-owned address or locator. Core packages treat this as opaque transport data. */
  address?: string;
  /** Optional browser-client requirements for human-entrypoint providers. */
  client?: RuntimeClientDescriptor;
  /** Non-secret provider metadata for diagnostics or adapter-local selection. */
  metadata?: Record<string, unknown>;
}

/**
 * The well-known provider-neutral fields a structured {@link RuntimeHandle} may carry. A launcher MAY add its own
 * private fields (pid, ports, side-process ids) via the index signature; core packages must only consume
 * `endpoints` and opaque resource ids.
 *
 * Carries no secret. Agent-blind `secret_ref` values are minted separately by the CapabilityService.
 */
export interface RuntimeDescriptor {
  /** Launcher-reported mode/status as a non-authorizing diagnostic hint. */
  launchMode?: string;
  /** Runtime-owned connector and entrypoint descriptors. */
  endpoints?: RuntimeEndpointDescriptor[];
  /** Launcher-private extras (pid, ports, side-process ids) — opaque to the ports. */
  [k: string]: unknown;
}

/** Encode a {@link RuntimeDescriptor} into an opaque kernel {@link RuntimeHandle}. */
export function encodeRuntimeHandle(d: RuntimeDescriptor): RuntimeHandle {
  return JSON.stringify(d) as unknown as RuntimeHandle;
}

/**
 * Decode a {@link RuntimeHandle} back into its {@link RuntimeDescriptor}, or `undefined` if the handle
 * is not a structured JSON payload (so callers fail closed: no CDP url ⇒ no live connector, etc.).
 */
export function decodeRuntimeHandle(h: RuntimeHandle): RuntimeDescriptor | undefined {
  try {
    const d = JSON.parse(h as unknown as string) as RuntimeDescriptor;
    if (d !== null && typeof d === "object") {
      return d;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Return the first runtime endpoint matching a family and optional provider/transport filter. */
export function runtimeEndpoint(
  descriptor: RuntimeDescriptor | undefined,
  match: {
    family: RuntimeEndpointFamily;
    provider?: string;
    transport?: RuntimeEndpointTransport;
  },
): RuntimeEndpointDescriptor | undefined {
  for (const endpoint of descriptor?.endpoints ?? []) {
    if (endpoint.family !== match.family) {
      continue;
    }
    if (match.provider !== undefined && endpoint.provider !== match.provider) {
      continue;
    }
    if (match.transport !== undefined && endpoint.transport !== match.transport) {
      continue;
    }
    return endpoint;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spawn context — a neutral side-channel from the worker (which realizes the workspace) to the
// launcher (which spawns the capsule into it), WITHOUT changing the frozen `LauncherPort.spawn(spec,
// asUid)` signature and WITHOUT one adapter importing another. The worker associates the realized
// workspace handle with the (immutable) resolved-spec INSTANCE; the launcher reads it back. Keyed by
// object identity (a WeakMap), so it neither mutates the frozen spec nor leaks (entries are GC'd with
// the spec). This lives in the kernel because the worker (core-adjacent) and the launcher (adapter)
// both depend on the kernel but never on each other (the boundary lint).
// ─────────────────────────────────────────────────────────────────────────────

/** The per-spawn context the worker hands the launcher (the realized workspace, the agent uid). */
export interface SpawnContext {
  /** The workspace handle the worker realized (so the launcher can read e.g. the profile dir). */
  workspace: WorkspaceHandleRef;
}

const SPAWN_CONTEXT = new WeakMap<object, SpawnContext>();

/** Associate a {@link SpawnContext} with a resolved-spec instance (called by the worker before spawn). */
export function setSpawnContext(spec: ResolvedAssemblySpec, ctx: SpawnContext): void {
  SPAWN_CONTEXT.set(spec as object, ctx);
}

/** Read the {@link SpawnContext} for a resolved-spec instance (called by the launcher), or undefined. */
export function getSpawnContext(spec: ResolvedAssemblySpec): SpawnContext | undefined {
  return SPAWN_CONTEXT.get(spec as object);
}

export type { Ref, ResolvedAssemblySpec, RuntimeHandle };
