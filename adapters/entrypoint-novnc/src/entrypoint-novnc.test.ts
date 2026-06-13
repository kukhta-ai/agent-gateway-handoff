// CONTRACT tests for the noVNC Human-Entrypoint adapter (adapters/entrypoint-novnc, GLA-023).
// FULL mode: open → the internal noVNC ws endpoint (what the gateway proxies in Slice 4). HEADLESS
// mode: open → throws dependency.unavailable (the noVNC entrypoint is UNAVAILABLE; real in hermes-1).
// No browser — uses encoded runtime handles.

import { type RuntimeHandle, encodeRuntimeHandle } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  EntrypointNovncAdapter,
  NOVNC_CLIENT_ASSET_REF,
  RFB_WEB_CLIENT_KIND,
  novncClientAssetMounts,
} from "./index.js";

describe("EntrypointNovncAdapter.open — mode-aware human entrypoint (GLA-023)", () => {
  it("FULL mode: returns the internal noVNC ws endpoint (the gateway proxies it in Slice 4)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({
      launchMode: "full",
      endpoints: [
        {
          resourceId: "entrypoint:novnc:test",
          family: "human-entrypoint",
          provider: "novnc",
          transport: "websocket",
          address: "ws://127.0.0.1:6080/",
          client: { kind: "gateway-page", ref: "handoff" },
        },
      ],
    });
    const out = await e.open(runtime);
    expect(out.resourceId).toBe("entrypoint:novnc:test");
    expect(out.client).toMatchObject({
      kind: RFB_WEB_CLIENT_KIND,
      ref: NOVNC_CLIENT_ASSET_REF,
      bootstrap: { module: "core/rfb.js" },
    });
    expect(out.transport.upstream).toBe("ws://127.0.0.1:6080/");
    expect(e.isAvailable(runtime)).toBe(true);
  });

  it("resolves bundled noVNC RFB assets for the gateway's generic client-asset host", () => {
    const mounts = novncClientAssetMounts({});
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({ ref: NOVNC_CLIENT_ASSET_REF, cacheControl: "no-cache" });
    expect(mounts[0]?.root).toMatch(/@novnc[\/\\]novnc/);
  });

  it("HEADLESS mode: open throws dependency.unavailable (no human-view stack)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({
      launchMode: "headless",
    });
    await expect(e.open(runtime)).rejects.toMatchObject({ code: "dependency.unavailable" });
    expect(e.isAvailable(runtime)).toBe(false);
  });

  it("full mode but NO noVNC endpoint on the handle → unavailable (defensive)", async () => {
    const e = new EntrypointNovncAdapter();
    const runtime = encodeRuntimeHandle({ launchMode: "full" });
    await expect(e.open(runtime)).rejects.toMatchObject({ code: "dependency.unavailable" });
  });

  it("a garbage handle → state.no_live_capsule (not a crash)", async () => {
    const e = new EntrypointNovncAdapter();
    await expect(e.open("garbage" as unknown as RuntimeHandle)).rejects.toMatchObject({
      code: "state.no_live_capsule",
    });
  });
});
