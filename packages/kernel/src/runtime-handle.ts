// K-runtime — the RuntimeHandle structured-payload convention (kernel-contracts.md §6, capsule.md).
// A `RuntimeHandle` (entities.ts) is an opaque `Ref<"runtime">` the worker plane hands back from the
// launcher. Its INTERNAL structure is a launcher concern, but the human-entrypoint and agent-connector
// PORTS receive that same handle (`open(h)` / `attach(h)`) and must read well-known fields off it (the
// CDP url, the noVNC endpoint, the launch mode). To keep those facts a SHARED contract — rather than
// forcing one adapter to import another (the boundary lint forbids adapter→adapter) — the kernel owns a
// tiny, generic codec: a structured handle is JSON with a few well-known OPTIONAL fields plus arbitrary
// launcher extras. No process-specifics live here; the launcher writes the fields, the connector and
// entrypoint read them, all through this one neutral codec.

import type { ResolvedAssemblySpec } from "./assembly.js";
import type { Ref } from "./brands.js";
import type { RuntimeHandle } from "./entities.js";

/** A realized-workspace handle (kept structural — the worker/workspace/launcher agree on it). */
export type WorkspaceHandleRef = Ref<"workspace">;

/**
 * The well-known fields a structured {@link RuntimeHandle} may carry (all OPTIONAL — a launcher
 * populates what applies to its tier). The agent-connector reads `cdpWebSocketUrl`; the human
 * entrypoint reads `novncEndpoint` + `mode`. A launcher MAY add its own private fields (pid, ports,
 * side-process ids) — they ride alongside via the index signature and are opaque to the ports.
 *
 * **Carries no secret** — a runtime handle is bookkeeping (addresses + pids), never a credential. The
 * agent-blind `secret_ref` is minted separately by the CapabilityService (a capability reference), not
 * stored here.
 */
export interface RuntimeDescriptor {
  /** The launch mode, e.g. "full" (headed + noVNC) or "headless" (CDP only). */
  mode?: string;
  /** The raw CDP `webSocketDebuggerUrl` (the agent connector), bound to loopback. */
  cdpWebSocketUrl?: string;
  /** The internal noVNC ws endpoint (the human entrypoint; absent in headless mode). */
  novncEndpoint?: string;
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
