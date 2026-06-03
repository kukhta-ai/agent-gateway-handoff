// Unit tests for the CapabilityService (packages/capability). The load-bearing negative is
// GLA-014 AC#3: a forged/tampered agent-authority token is REJECTED (non-forgeable issuance). Also
// covers the whoami JSON shape (GLA-017 AC#1) and revocation. Pure in-process; no I/O.
import { HmacCapabilitySigner, type OpaqueToken } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { type AuthorityProfile, CapabilityService } from "./index.js";

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
