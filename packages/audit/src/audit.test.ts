import { describe, expect, it } from "vitest";
import { auditEgressJson, redactAuditEgress } from "./index.js";

describe("audit egress redaction", () => {
  it("removes raw secrets, grant tokens, and full grant URLs while preserving repair metadata", () => {
    const event = {
      kind: "dependency.binding",
      taskId: "task_1",
      sessionId: "sess_1",
      publicBaseUrl: "https://gla.example/team-a/",
      ownershipMode: "managed",
      checksums: { "gla.env": "sha256:abc" },
      connection: {
        issuer: "https://auth.example/application/o/gla/",
        clientId: "gla-client",
        secretRef: "secret:gla/authentik/client-secret",
        clientSecret: "raw-client-secret-canary",
      },
      invite: {
        link: "https://gla.example/team-a/enroll?grant=enroll-grant-canary",
      },
      handoff: {
        link: "https://gla.example/team-a/handoff/sess_secret?grant=handoff-grant-canary",
      },
      diagnostics: "grant=diag-grant-canary&code=oidc-code-canary",
    };

    const redacted = redactAuditEgress(event) as typeof event;
    const serialized = JSON.stringify(redacted);

    for (const raw of [
      "raw-client-secret-canary",
      "enroll-grant-canary",
      "handoff-grant-canary",
      "sess_secret",
      "diag-grant-canary",
      "oidc-code-canary",
    ]) {
      expect(serialized).not.toContain(raw);
    }
    expect(redacted.publicBaseUrl).toBe(event.publicBaseUrl);
    expect(redacted.ownershipMode).toBe("managed");
    expect(redacted.checksums).toEqual({ "gla.env": "sha256:abc" });
    expect(redacted.connection.secretRef).toBe("secret:gla/authentik/client-secret");
    expect(redacted.connection.clientSecret).toBe("<redacted>");
    expect(redacted.invite.link).toBe("<redacted-url>");
    expect(redacted.handoff.link).toBe("<redacted-url>");
    expect(redacted.diagnostics).toBe("grant=<redacted>&code=<redacted>");
  });

  it("serializes redacted audit records as JSON lines for operator sinks", () => {
    const line = auditEgressJson({
      kind: "handoff.opened",
      link: "https://gla.example/handoff/sess_secret?grant=grant-canary",
      token: "raw-token-canary",
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(line).not.toContain("sess_secret");
    expect(line).not.toContain("grant-canary");
    expect(line).not.toContain("raw-token-canary");
    expect(JSON.parse(line)).toEqual({
      kind: "handoff.opened",
      link: "<redacted-url>",
      token: "<redacted>",
    });
  });
});
