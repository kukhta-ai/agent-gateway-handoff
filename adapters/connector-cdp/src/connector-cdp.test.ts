// CONTRACT tests for the CDP Agent-Connector adapter (adapters/connector-cdp, GLA-024/025).
// attach → { type:"cdp", cdp_url, secret_ref }. AGENT-BLIND: the secret_ref is a capability REFERENCE
// (bound by the session saga), never a raw secret/signing key. A handle with no CDP endpoint →
// state.no_live_capsule. No browser — uses encoded runtime handles.

import { type Ref, type RuntimeHandle, encodeRuntimeHandle } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { ConnectorCdpAdapter } from "./index.js";

function runtimeWithCdp(url: string): RuntimeHandle {
  return encodeRuntimeHandle({ mode: "headless", cdpWebSocketUrl: url, cdpPort: 9 });
}

const FAKE_SECRET_REF = "cap_connector_abc" as unknown as Ref<"secret-ref">;

describe("ConnectorCdpAdapter.attach — the agent's CDP handle (GLA-024/025)", () => {
  it("returns {type:cdp, cdp_url} from the runtime handle's webSocketDebuggerUrl", async () => {
    const c = new ConnectorCdpAdapter();
    const url = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const connector = await c.attach(runtimeWithCdp(url));
    expect(connector.type).toBe("cdp");
    expect(connector.cdp_url).toBe(url);
  });

  it("AGENT-BLIND: a bound secret_ref is a capability REFERENCE on the connector, never a raw secret", async () => {
    const c = new ConnectorCdpAdapter();
    const url = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    // The session saga binds the minted secret_ref to the capsule (by CDP url) before re-attach.
    c.bindSecretRef(url, FAKE_SECRET_REF);
    const connector = await c.attach(runtimeWithCdp(url));
    expect(connector.secret_ref).toBe(FAKE_SECRET_REF);
    // SCAN the connector JSON: it carries a secret_ref (a cap ref) and NO raw secret / signing material.
    const json = JSON.stringify(connector);
    expect(json).toContain("secret_ref");
    expect(String(connector.secret_ref)).toMatch(/^cap_/);
    expect(json).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(json.toLowerCase()).not.toContain("signing");
    expect(json.toLowerCase()).not.toContain("hmac");
  });

  it("without a bound ref, the connector still returns the CDP url (secret_ref omitted)", async () => {
    const c = new ConnectorCdpAdapter();
    const url = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const connector = await c.attach(runtimeWithCdp(url));
    expect(connector.cdp_url).toBe(url);
    expect(connector.secret_ref).toBeUndefined();
  });

  it("unbindSecretRef drops the ref (teardown); a re-attach then omits it", async () => {
    const c = new ConnectorCdpAdapter();
    const url = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    c.bindSecretRef(url, FAKE_SECRET_REF);
    expect((await c.attach(runtimeWithCdp(url))).secret_ref).toBe(FAKE_SECRET_REF);
    c.unbindSecretRef(url);
    expect((await c.attach(runtimeWithCdp(url))).secret_ref).toBeUndefined();
  });

  it("a runtime handle with no CDP endpoint → state.no_live_capsule (not a crash)", async () => {
    const c = new ConnectorCdpAdapter();
    const noCdp = encodeRuntimeHandle({ mode: "headless" });
    await expect(c.attach(noCdp)).rejects.toMatchObject({ code: "state.no_live_capsule" });
    // A garbage handle too.
    await expect(c.attach("garbage" as unknown as RuntimeHandle)).rejects.toMatchObject({
      code: "state.no_live_capsule",
    });
  });

  it("a custom secretRefFor resolver is honored (the saga can wire its own lookup)", async () => {
    const url = "ws://127.0.0.1:42799/devtools/browser/abc-123";
    const c = new ConnectorCdpAdapter({ secretRefFor: () => FAKE_SECRET_REF });
    expect((await c.attach(runtimeWithCdp(url))).secret_ref).toBe(FAKE_SECRET_REF);
  });
});
