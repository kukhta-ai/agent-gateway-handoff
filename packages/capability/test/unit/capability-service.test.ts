// Unit tests for the CapabilityService (packages/capability). The load-bearing negative is
// GLA-014 AC#3: a forged/tampered agent-authority token is REJECTED (non-forgeable issuance). Also
// covers the whoami JSON shape (GLA-017 AC#1) and revocation. Pure in-process; no I/O.
import { HmacCapabilitySigner, type OpaqueToken } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { type AuthorityProfile, CapabilityService } from "../../src/index.js";

const PROFILE: AuthorityProfile = {
  profile: "local-single-operator",
  identity: "agent:local",
  allowedOps: ["task.create", "session.create", "handoff.open", "whoami"],
};

describe("CapabilityService.mintAgentAuthority + whoami", () => {
  it("whoami returns identity + authority_profile + allowed_ops (GLA-017 AC#1)", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintAgentAuthority(PROFILE);
    const who = svc.whoami(token);
    // The exact JSON shape the CLI emits.
    expect(who).toEqual({
      identity: "agent:local",
      authority_profile: "local-single-operator",
      allowed_ops: ["task.create", "session.create", "handoff.open", "whoami"],
    });
    // It must be serializable as-is (the CLI prints JSON to stdout).
    expect(JSON.parse(JSON.stringify(who))).toEqual(who);
  });

  it("the anchor is a root agent-authority carrying the allowed-ops + profile caveats", async () => {
    const svc = new CapabilityService();
    const { capability } = await svc.mintAgentAuthority(PROFILE);
    expect(capability.cls).toBe("agent-authority");
    expect(capability.parentRef).toBeUndefined(); // root: no parent
    expect(capability.caveats).toEqual(
      expect.arrayContaining([
        { kind: "authority-profile", profile: "local-single-operator" },
        { kind: "allowed-ops", ops: PROFILE.allowedOps },
        { kind: "audience", id: "agent:local" },
      ]),
    );
  });
});

describe("non-forgeable issuance (GLA-014 AC#3)", () => {
  it("rejects a TAMPERED token (a flipped byte in the encoded payload)", async () => {
    const svc = new CapabilityService();
    const { token } = await svc.mintAgentAuthority(PROFILE);
    // Flip one character of the base64url token → the HMAC chain no longer verifies.
    const chars = token.split("");
    const i = Math.floor(chars.length / 2);
    chars[i] = chars[i] === "A" ? "B" : "A";
    const tampered = chars.join("") as OpaqueToken;
    expect(() => svc.whoami(tampered)).toThrowError(/rejected|malformed/i);
  });

  it("rejects a FORGED token whose unsigned fields claim extra ops (no valid signature)", async () => {
    const svc = new CapabilityService();
    // An attacker hand-crafts a payload that *looks* like an agent-authority with broad ops but
    // was never signed by the service's key. whoami must verify(), not trust the bytes.
    const forgedPayload = {
      id: "cap_forged",
      cls: "agent-authority",
      lineage: [],
      caveats: [
        { kind: "authority-profile", profile: "local-single-operator" },
        { kind: "allowed-ops", ops: ["task.create", "session.create", "ROOT", "admin.everything"] },
        { kind: "audience", id: "agent:local" },
      ],
      tag: "deadbeef".repeat(8), // a bogus tag — not the real HMAC chain
    };
    const forged = Buffer.from(JSON.stringify(forgedPayload), "utf8").toString(
      "base64url",
    ) as OpaqueToken;
    // The forged "extra ops" must NEVER be surfaced — the whole token is rejected.
    expect(() => svc.whoami(forged)).toThrowError(/rejected|malformed/i);
  });

  it("a token minted under a DIFFERENT key does not verify (wrong signer)", async () => {
    const minter = new CapabilityService(new HmacCapabilitySigner(Buffer.alloc(32, 1)));
    const verifier = new CapabilityService(new HmacCapabilitySigner(Buffer.alloc(32, 2)));
    const { token } = await minter.mintAgentAuthority(PROFILE);
    expect(() => verifier.whoami(token)).toThrowError(/rejected|malformed/i);
  });
});

describe("CapabilityService.mintConnector — agent-blind connector ref (GLA-024/025)", () => {
  it("mints a secret-ref-class capability bound to the session (audience caveat)", async () => {
    const svc = new CapabilityService();
    const { capability, secretRef } = await svc.mintConnector("sess_1");
    expect(capability.cls).toBe("secret-ref");
    // Bound to exactly this session's capsule (agent-blind, per-capsule).
    expect(capability.caveats).toEqual(
      expect.arrayContaining([
        { kind: "audience", id: "sess_1" },
        { kind: "scope", path: "/session/sess_1/connector" },
      ]),
    );
    // The agent-blind secret_ref IS the capability id (a reference), NOT the bearer token bytes.
    expect(secretRef).toBe(capability.id);
    expect(String(secretRef)).toMatch(/^cap_/);
  });

  it("AGENT-BLIND: the secret_ref is a capability REFERENCE, never the bearer token / signing material", async () => {
    const svc = new CapabilityService();
    const { token, secretRef } = await svc.mintConnector("sess_1");
    // The bearer token (the signed bytes) is held GLA-side; the agent-facing secret_ref is the id.
    expect(String(secretRef)).not.toBe(String(token));
    // The secret_ref must NOT contain the (long, base64url) token bytes — it is a short id reference.
    expect(String(token).length).toBeGreaterThan(String(secretRef).length);
    expect(String(token)).not.toContain(String(secretRef));
  });

  it("descends from the task capability (parent) so a lineage revoke CASCADES to it (real verify) — #1", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    // A parent capability (stand-in for the session's task cap).
    const parent = await signer.mint({
      cls: "task",
      caveats: [{ kind: "scope", path: "/task/task_1" }],
    });
    const { capability, token } = await svc.mintConnector("sess_1", parent.capability.id);
    expect(capability.parentRef).toBe(parent.capability.id);
    expect(capability.lineage).toContain(parent.capability.id);

    // The connector cap carries a `scope` caveat (/session/<id>/connector), so verify is presented WITH
    // that scope path (else the kernel fails closed on the scope caveat — auth.scope_required).
    const ctx = () => ({
      now: new Date().toISOString() as never,
      revocations: signer.revocationSnapshot(),
      scopePath: "/session/sess_1/connector",
    });
    // BEFORE the parent is revoked the connector's OWN token verifies (a clean connector).
    expect(signer.verify(token, ctx()).ok).toBe(true);

    // Revoking the PARENT (the task cap) invalidates the connector by LINEAGE — verify the connector's
    // OWN token now fails closed with auth.revoked (the real cascade the app wiring relies on).
    await signer.revoke(parent.capability.id);
    const after = signer.verify(token, ctx());
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.reason).toBe("auth.revoked");
  });

  it("minted as a ROOT (no parentRef) when no parent is supplied — the explicit fallback", async () => {
    const signer = new HmacCapabilitySigner();
    const svc = new CapabilityService(signer);
    const { capability, token } = await svc.mintConnector("sess_1");
    // No parent → empty lineage; revoking some unrelated task cap does NOT cascade to it.
    expect(capability.parentRef).toBeUndefined();
    expect(capability.lineage ?? []).toHaveLength(0);
    const unrelated = await signer.mint({ cls: "task", caveats: [] });
    await signer.revoke(unrelated.capability.id);
    // Presented WITH the connector's scope path (it carries a scope caveat); an unrelated revoke does
    // not touch its lineage, so it still verifies ok.
    expect(
      signer.verify(token, {
        now: new Date().toISOString() as never,
        revocations: signer.revocationSnapshot(),
        scopePath: "/session/sess_1/connector",
      }).ok,
    ).toBe(true); // a root connector is unaffected by an unrelated revoke
  });

  it("revoke(connectorCapId) invalidates the connector capability", async () => {
    const svc = new CapabilityService();
    const { capability } = await svc.mintConnector("sess_1");
    // Revoking the connector cap by its id is the saga's compensation / teardown path.
    await expect(svc.revoke(capability.id)).resolves.toBeUndefined();
    expect(svc.revocationSnapshot().has(capability.id)).toBe(true);
  });
});

describe("CapabilityService.revoke", () => {
  it("a revoked anchor is rejected by whoami (auth.revoked)", async () => {
    const svc = new CapabilityService();
    const { capability, token } = await svc.mintAgentAuthority(PROFILE);
    // Valid before revoke.
    expect(svc.whoami(token).identity).toBe("agent:local");
    await svc.revoke(capability.id);
    // Rejected after revoke — the held revocation snapshot is consulted by verify().
    expect(() => svc.whoami(token)).toThrowError(/revoked|rejected/i);
  });
});
