import { describe, expect, it } from "vitest";
import {
  isRedactionOrTemplatePlaceholder,
  redactOperatorEgress,
  redactOperatorText,
} from "./redaction.js";

describe("isRedactionOrTemplatePlaceholder", () => {
  it("detects redaction and unresolved template placeholders", () => {
    for (const value of [
      "***",
      "******",
      "<redacted>",
      "<REDACTED>",
      "<secret>",
      "https://gla.example/<team>/",
      "⟨https://your-public-host/⟩",
    ]) {
      expect(isRedactionOrTemplatePlaceholder(value), value).toBe(true);
    }
  });

  it("leaves usable public config and secret-store references alone", () => {
    for (const value of [
      "https://gla.example/team-a/",
      "secret://gla/authentik/client-secret",
      "secret:gla/browser-runtime/client",
      "phishing-resistant",
      "gla-client",
    ]) {
      expect(isRedactionOrTemplatePlaceholder(value), value).toBe(false);
    }
  });
});

describe("operator redaction", () => {
  it("removes grant-bearing URLs and raw credential values from text", () => {
    const redacted = redactOperatorText(
      [
        "https://gla.example/team/handoff/sess_secret?grant=grant-canary&x=1",
        "https://gla.example/team/enroll?grant=enroll-canary",
        "grant=abc123&code=oidc-code&state=oidc-state",
        '{"client_secret":"s3","codeVerifier":"v","token":"t","password":"p"}',
      ].join(" "),
    );

    for (const raw of [
      "sess_secret",
      "grant-canary",
      "enroll-canary",
      "abc123",
      "oidc-code",
      "oidc-state",
      '"s3"',
      '"v"',
      '"t"',
      '"p"',
    ]) {
      expect(redacted).not.toContain(raw);
    }
    expect(redacted).toContain("<redacted-url>");
    expect(redacted).toContain("<redacted>");
  });

  it("recursively redacts operator egress while preserving non-sensitive repair context", () => {
    const redacted = redactOperatorEgress({
      kind: "dependency-binding",
      code: "auth.expired",
      publicBaseUrl: "https://gla.example/team-a/",
      ownershipMode: "managed",
      state: "open",
      checksum: "sha256:abc",
      "grant=key-grant-canary": "visible",
      connector: {
        secret_ref: "cap_connector",
        secretRef: "secret:gla/authentik/client-secret",
        clientSecret: "raw-client-secret",
        recordedClientSecret: {
          kind: "secret-ref",
          ref: "secret:gla/authentik/client-secret",
        },
        authentikClientSecret: "CLIENT_SECRET_CANARY_084",
      },
      invite: {
        link: "https://gla.example/team-a/enroll?grant=enroll-canary",
      },
      notes: ["state=oidc-state"],
      detail: "raw-token-canary",
    });

    expect(redacted).toEqual({
      kind: "dependency-binding",
      code: "auth.expired",
      publicBaseUrl: "https://gla.example/team-a/",
      ownershipMode: "managed",
      state: "open",
      checksum: "sha256:abc",
      "grant=<redacted>": "visible",
      connector: {
        secret_ref: "cap_connector",
        secretRef: "secret:gla/authentik/client-secret",
        clientSecret: "<redacted>",
        recordedClientSecret: {
          kind: "secret-ref",
          ref: "secret:gla/authentik/client-secret",
        },
        authentikClientSecret: "<redacted>",
      },
      invite: {
        link: "<redacted-url>",
      },
      notes: ["state=<redacted>"],
      detail: "<redacted-canary>",
    });
  });
});
