// @gla/entrypoint-novnc — adapter ring (baseline §1, docs/03 §6, GLA-023).
// HumanEntrypoint: noVNC live-view. Implements the kernel `HumanEntrypointPort`:
//   open(runtime) → { internalEndpoint }   — the capsule's INTERNAL noVNC ws endpoint, the address the
//     Access Gateway will proxy in Slice 4 (the human side of the two-actor capsule). It is the
//     agent-blind input path: human keystrokes reach the site, never the agent (capsule.md invariant).
//
// MODE-AWARE: the noVNC endpoint exists ONLY in FULL mode (Xvfb→x11vnc→websockify present). In HEADLESS
// mode (the dev env: no human-view stack) there is NO live view to proxy, so `open` reports the
// entrypoint UNAVAILABLE (throws `dependency.unavailable`). The worker catches that and provisions a
// CDP-only capsule (the noVNC path is real in hermes-1 where the wpm human-view bundle is present).
//
// Boundary (adapter ring): depends ONLY on @gla/kernel — it reads the noVNC endpoint + mode off the
// runtime handle via the kernel's neutral `decodeRuntimeHandle` codec (NOT by importing the launcher
// adapter; the boundary lint forbids adapter→adapter). It is injected at `app`; core never imports it.

import {
  type HumanEntrypointBinding,
  type HumanEntrypointPort,
  type RuntimeHandle,
  decodeRuntimeHandle,
  glaError,
  runtimeEndpoint,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const ENTRYPOINT_NOVNC_MODULE = "@gla/entrypoint-novnc" as const;
/** Ring classification from the architecture baseline (informational). */
export const ENTRYPOINT_NOVNC_RING = "adapter" as const;

/**
 * The noVNC Human-Entrypoint adapter (docs/03 §6). `open` returns the capsule's internal noVNC ws
 * endpoint (full mode) — what the gateway proxies in Slice 4. In headless mode (no human-view stack)
 * there is no live view, so it throws `dependency.unavailable` (the entrypoint is UNAVAILABLE) — the
 * worker degrades to a CDP-only capsule. This adapter reads the endpoint off the runtime handle the
 * launcher produced; it stands nothing up itself (the launcher already ran x11vnc/websockify in full
 * mode).
 */
export class EntrypointNovncAdapter implements HumanEntrypointPort {
  /**
   * Open the human entrypoint (kernel `HumanEntrypointPort.open`): the internal noVNC ws endpoint the
   * gateway proxies. Throws `dependency.unavailable` when the capsule is headless (no noVNC endpoint on
   * the runtime) — the honest "this path is unavailable in this mode" the worker degrades on.
   */
  async open(handle: RuntimeHandle): Promise<HumanEntrypointBinding> {
    const runtime = decodeRuntimeHandle(handle);
    if (runtime === undefined) {
      throw glaError("state.no_live_capsule", "no live capsule to open a human entrypoint on", {});
    }
    const endpoint = runtimeEndpoint(runtime, {
      family: "human-entrypoint",
      provider: "novnc",
      transport: "websocket",
    });
    const novnc = typeof endpoint?.address === "string" ? endpoint.address : undefined;
    const launchMode =
      typeof runtime.launchMode === "string"
        ? runtime.launchMode
        : typeof runtime.mode === "string"
          ? runtime.mode
          : undefined;
    if (launchMode === "headless" || endpoint === undefined || novnc === undefined) {
      // Headless: no human-view stack → the noVNC entrypoint is unavailable. Real in hermes-1 (full mode).
      throw glaError(
        "dependency.unavailable",
        "noVNC human entrypoint is unavailable in headless mode (no human-view stack)",
        { detail: { mode: launchMode } },
      );
    }
    return {
      resourceId: endpoint.resourceId,
      provider: endpoint.provider,
      client: endpoint.client ?? { kind: "gateway-page", ref: "handoff" },
      transport: { kind: "reverse-proxy", protocol: "websocket", upstream: novnc },
    };
  }

  /** Is a human entrypoint available for this runtime? (Convenience for the worker / a probe.) */
  isAvailable(handle: RuntimeHandle): boolean {
    const runtime = decodeRuntimeHandle(handle);
    const endpoint = runtimeEndpoint(runtime, {
      family: "human-entrypoint",
      provider: "novnc",
      transport: "websocket",
    });
    return (
      runtime !== undefined &&
      runtime.launchMode === "full" &&
      typeof endpoint?.address === "string"
    );
  }
}

export type { HumanEntrypointBinding, HumanEntrypointPort, RuntimeHandle };
