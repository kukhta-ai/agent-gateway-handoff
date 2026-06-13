/**
 * Detect operator redaction/template sentinels that must never be accepted as real config, secret, env, or receipt
 * values. This intentionally catches unresolved installer placeholders (`<...>` and `⟨...⟩`) plus common redaction
 * sentinels while leaving ordinary public strings untouched.
 */
export function isRedactionOrTemplatePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (/^\*{3,}$/.test(trimmed)) {
    return true;
  }
  if (/^<\s*redacted\s*>$/i.test(trimmed)) {
    return true;
  }
  return /<[^<>]+>|⟨[^⟨⟩]+⟩/u.test(value);
}

const QUERY_SECRET_KEY_RE =
  /\b(grant|code|state|nonce|code_verifier|codeVerifier|id_token|access_token|refresh_token|client_secret|clientSecret|secret|token|password|credential|private[_-]?key)=([^&\s"']+)/gi;

const JSON_SECRET_FIELD_RE =
  /"?(grant|code|state|nonce|code_verifier|codeVerifier|id_token|access_token|refresh_token|client_secret|clientSecret|secret|token|password|credential|private[_-]?key)"?\s*:\s*"[^"]*"/gi;

const CANARY_SECRET_VALUE_RE =
  /\b[A-Za-z0-9._~+/-]*(?:secret|token|grant)[A-Za-z0-9._~+/-]*canary[A-Za-z0-9._~+/-]*\b/gi;

const HTML_BREAKOUT_VALUE_RE = /<\/?script\b[^>]*>|javascript:/gi;

function isRawSecretKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  if (normalized === "secretref" || normalized.endsWith("secretref")) {
    return false;
  }
  return (
    normalized === "grant" ||
    normalized === "nonce" ||
    normalized === "codeverifier" ||
    normalized === "idtoken" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("privatekey")
  );
}

function isSecretReferenceValue(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "secret-ref" &&
    typeof (value as Record<string, unknown>).ref === "string" &&
    ((value as Record<string, unknown>).ref as string).startsWith("secret:")
  );
}

/**
 * Redact bearer and credential-shaped text before it crosses an operator-facing egress boundary. It removes full
 * grant-bearing handoff/enrollment URLs, key-value secret fields, JSON secret fields, and GLA capability-shaped bearer
 * strings while preserving non-sensitive repair context around them.
 */
export function redactOperatorText(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text
    .replace(
      /\bhttps?:\/\/[^\s"']*\/(?:handoff\/[^\s"'/?#]+|enroll)\?[^ \t\r\n"']*\bgrant=[^ \t\r\n"']*/gi,
      "<redacted-url>",
    )
    .replace(QUERY_SECRET_KEY_RE, "$1=<redacted>")
    .replace(JSON_SECRET_FIELD_RE, '"$1":"<redacted>"')
    .replace(CANARY_SECRET_VALUE_RE, "<redacted-canary>")
    .replace(HTML_BREAKOUT_VALUE_RE, "<redacted-html>");
}

/** Recursively redact operator-facing JSON-like values without mutating the original object. */
export function redactOperatorEgress(value: unknown): unknown {
  if (typeof value === "string") {
    return redactOperatorText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactOperatorEgress(item));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const redactedKey = redactOperatorText(key);
      redacted[redactedKey] =
        isRawSecretKey(key) && !isSecretReferenceValue(entry)
          ? "<redacted>"
          : redactOperatorEgress(entry);
    }
    return redacted;
  }
  return value;
}
