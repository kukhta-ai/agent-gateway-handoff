#!/usr/bin/env node
// probe-authentik.mjs — verify a running authentik answers the way GLA's adapter needs (identity-provider · GLA-074).
//
// The §7 (authentik-service-standup.md) "the provider answers + the RP app exists" probes, as REAL runnable
// logic (Node 22 native fetch — no deps). Run against the LIVE instance from where GLA runs (so reachability is
// proven from the GLA container, not just the host). The install-backlog verify task (identity-provider-6
// AC#1/#2/#5) consumes this; the end-to-end passkey/password + same-sub proofs need a real login and are the
// deploy's job (smoke-amr-strength.mjs covers the deterministic mapping layer here).
//
// USAGE:
//   node probe-authentik.mjs <issuerUrl> [clientId] [redirectUri]
//   GLA_AUTHENTIK_ISSUER_URL=… GLA_AUTHENTIK_CLIENT_ID=… GLA_AUTHENTIK_REDIRECT_URI=… node probe-authentik.mjs
//
// CHECKS (each prints PASS/FAIL with detail):
//   1. discovery   — GET <issuer>/.well-known/openid-configuration → 200 + valid JSON advertising authorization,
//                    token, jwks endpoints; the doc's `issuer` EQUALS the configured issuer (the adapter validates iss).
//   2. jwks        — GET the advertised jwks_uri → 200 + a non-empty `keys` array (signatures are verifiable).
//   3. token-ep    — the advertised token endpoint answers (a bare GET/OPTIONS resolves — endpoint is live).
//   4. authorize   — (only with clientId+redirectUri) build the /authorize request the adapter would and GET it;
//                    the client + redirect_uri are ACCEPTED (a login/consent page or a redirect to the flow), NOT
//                    rejected as unknown-client / unregistered redirect_uri / invalid_request.
//
// EXIT: 0 iff every attempted check PASSes; 1 otherwise (a typed summary on the last line so a caller can branch).

const args = process.argv.slice(2);
const issuer = (args[0] ?? process.env.GLA_AUTHENTIK_ISSUER_URL ?? "").trim();
const clientId = (args[1] ?? process.env.GLA_AUTHENTIK_CLIENT_ID ?? "").trim();
const redirectUri = (args[2] ?? process.env.GLA_AUTHENTIK_REDIRECT_URI ?? "").trim();

if (!issuer) {
  console.error("usage: node probe-authentik.mjs <issuerUrl> [clientId] [redirectUri]");
  console.error("   (or set GLA_AUTHENTIK_ISSUER_URL [, _CLIENT_ID, _REDIRECT_URI])");
  console.log("PROBE_RESULT: usage_error");
  process.exit(2);
}

const TIMEOUT_MS = 8000;
let failures = 0;
const pass = (name, detail) => console.log(`PASS ${name}${detail ? `  — ${detail}` : ""}`);
const fail = (name, detail) => {
  failures++;
  console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`);
};

/** fetch with a hard timeout; returns { ok, status, json?, text?, error? }. Never throws. */
async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, ...opts });
    const text = await res.text().catch(() => "");
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, status: res.status, headers: res.headers, json, text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Join a path onto the issuer (issuer may or may not end with /). */
function wellKnownUrl(iss) {
  const base = iss.endsWith("/") ? iss : `${iss}/`;
  return new URL(".well-known/openid-configuration", base).toString();
}

const main = async () => {
  console.log(`probing authentik at issuer: ${issuer}`);

  // ── 1. discovery ──────────────────────────────────────────────────────────────────────────────────────
  const disco = await get(wellKnownUrl(issuer));
  let doc;
  if (disco.error) {
    fail(
      "discovery",
      `GET well-known failed: ${disco.error} (provider down / unreachable from here?)`,
    );
  } else if (disco.status !== 200 || !disco.json) {
    fail("discovery", `expected 200 + JSON, got ${disco.status}`);
  } else {
    doc = disco.json;
    const needed = ["authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"];
    const missing = needed.filter((k) => typeof doc[k] !== "string" || doc[k].length === 0);
    if (missing.length > 0) {
      fail("discovery", `doc missing: ${missing.join(", ")}`);
    } else if (doc.issuer !== issuer) {
      // The adapter validates the id_token `iss` against the CONFIGURED issuer — they must match exactly.
      fail(
        "discovery",
        `discovery issuer "${doc.issuer}" !== configured "${issuer}" (id_token iss check would fail)`,
      );
    } else {
      pass("discovery", "200; advertises authorize/token/jwks; issuer matches");
    }
  }

  // ── 2. jwks ───────────────────────────────────────────────────────────────────────────────────────────
  if (doc?.jwks_uri) {
    const jwks = await get(doc.jwks_uri);
    if (jwks.error) {
      fail("jwks", `GET jwks_uri failed: ${jwks.error}`);
    } else if (
      jwks.status !== 200 ||
      !Array.isArray(jwks.json?.keys) ||
      jwks.json.keys.length === 0
    ) {
      fail(
        "jwks",
        `expected 200 + non-empty keys[], got ${jwks.status} keys=${jwks.json?.keys?.length ?? 0}`,
      );
    } else {
      pass("jwks", `${jwks.json.keys.length} signing key(s)`);
    }
  } else {
    fail("jwks", "no jwks_uri to probe (discovery failed)");
  }

  // ── 3. token endpoint liveness ─────────────────────────────────────────────────────────────────────────
  if (doc?.token_endpoint) {
    // A bare GET to the token endpoint is not a valid grant, but a LIVE endpoint answers (405/400/200), whereas a
    // dead/unreachable one errors or 404s. We assert it RESOLVES (any HTTP status) rather than connection-fails.
    const tok = await get(doc.token_endpoint, { method: "GET" });
    if (tok.error) {
      fail("token-endpoint", `unreachable: ${tok.error}`);
    } else if (tok.status === 404) {
      fail("token-endpoint", "404 — endpoint not where discovery advertised it");
    } else {
      pass("token-endpoint", `answers (HTTP ${tok.status})`);
    }
  } else {
    fail("token-endpoint", "no token_endpoint to probe (discovery failed)");
  }

  // ── 4. authorize: the RP app (client + redirect) is recognized ───────────────────────────────────────────
  if (clientId && redirectUri) {
    if (doc?.authorization_endpoint) {
      const u = new URL(doc.authorization_endpoint);
      const p = u.searchParams;
      p.set("response_type", "code");
      p.set("client_id", clientId);
      p.set("redirect_uri", redirectUri);
      p.set("scope", "openid profile");
      p.set("state", "probe-state");
      p.set("nonce", "probe-nonce");
      p.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); // a fixed S256 sample (probe only)
      p.set("code_challenge_method", "S256");
      const authz = await get(u.toString());
      if (authz.error) {
        fail("authorize", `unreachable: ${authz.error}`);
      } else {
        // ACCEPTED looks like: a 200 login/consent page, OR a 302 to a flow/login URL (NOT to the redirect_uri
        // carrying an error). REJECTED looks like: an error body / redirect mentioning invalid_client /
        // unauthorized_client / redirect_uri_mismatch / unregistered.
        const body = (authz.text ?? "").toLowerCase();
        const loc = (authz.headers?.get?.("location") ?? "").toLowerCase();
        const rejected =
          /invalid_client|unauthorized_client|redirect_uri|unregistered|invalid_request|unknown.*client/.test(
            `${body} ${loc}`,
          );
        const isRedirectBackWithError =
          loc.startsWith(redirectUri.toLowerCase()) && loc.includes("error=");
        if (rejected || isRedirectBackWithError) {
          fail(
            "authorize",
            `client/redirect REJECTED (HTTP ${authz.status}${loc ? `, → ${loc}` : ""})`,
          );
        } else if (authz.status === 200 || (authz.status >= 300 && authz.status < 400)) {
          pass(
            "authorize",
            `client + redirect ACCEPTED (HTTP ${authz.status} — login/flow presented)`,
          );
        } else {
          fail("authorize", `unexpected response (HTTP ${authz.status})`);
        }
      }
    } else {
      fail("authorize", "no authorization_endpoint to probe (discovery failed)");
    }
  } else {
    console.log(
      "SKIP authorize — pass clientId + redirectUri to probe the RP application registration",
    );
  }

  // ── summary ───────────────────────────────────────────────────────────────────────────────────────────
  if (failures === 0) {
    console.log("PROBE_RESULT: available");
    process.exit(0);
  }
  console.log(`PROBE_RESULT: ${failures} check(s) failed`);
  process.exit(1);
};

main().catch((e) => {
  console.log(`PROBE_RESULT: unexpected_error ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
