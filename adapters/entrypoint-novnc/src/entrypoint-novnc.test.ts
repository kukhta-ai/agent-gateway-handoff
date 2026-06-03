// CONTRACT tests for the noVNC Human-Entrypoint adapter (adapters/entrypoint-novnc, GLA-023).
// FULL mode: open → the internal noVNC ws endpoint (what the gateway proxies in Slice 4). HEADLESS
// mode: open → throws dependency.unavailable (the noVNC entrypoint is UNAVAILABLE; real in hermes-1).
// No browser — uses encoded runtime handles.

import { type RuntimeHandle, encodeRuntimeHandle } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { EntrypointNovncAdapter } from "./index.js";

describe("EntrypointNovncAdapter.open — mode-aware human entrypoint (GLA-023)", () => {
  it("FULL mode: returns the internal noVNC ws endpoint (the gateway proxies it in Slice 4)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({
      mode: "full",
      cdpWebSocketUrl: "ws://127.0.0.1:9/x",
      novncEndpoint: "ws://127.0.0.1:6080/",
    });
    const out = await e.open(runtime);
    expect(out.internalEndpoint).toBe("ws://127.0.0.1:6080/");
    expect(e.isAvailable(runtime)).toBe(true);
  });

  it("HEADLESS mode: open throws dependency.unavailable (no human-view stack)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({
      mode: "headless",
      cdpWebSocketUrl: "ws://127.0.0.1:9/x",
    });
    await expect(e.open(runtime)).rejects.toMatchObject({ code: "dependency.unavailable" });
    expect(e.isAvailable(runtime)).toBe(false);
  });

  it("full mode but NO noVNC endpoint on the handle → unavailable (defensive)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({ mode: "full", cdpWebSocketUrl: "ws://127.0.0.1:9/x" });
    await expect(e.open(runtime)).rejects.toMatchObject({ code: "dependency.unavailable" });
  });

  it("a garbage handle → state.no_live_capsule (not a crash)", async () => {
    const e = new EntrypointNovncAdapter();
    await expect(e.open("garbage" as unknown as RuntimeHandle)).rejects.toMatchObject({
      code: "state.no_live_capsule",
    });
  });
});
