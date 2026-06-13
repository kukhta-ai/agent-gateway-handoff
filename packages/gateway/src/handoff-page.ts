// The handoff step-up web page served by the Access Gateway on a valid recipient-bound grant (scenario-01 Phase 6/12).
// A minimal, framework-free HTML+JS page (no build step). The step-up's COMPLETION MECHANISM is chosen by the SHAPE
// of the opaque options the gateway returns from /handoff/auth/options — a PROVIDER-AGNOSTIC discriminant, NOT any
// provider knowledge (the gateway names no provider; there is no provider string anywhere in this file):
//   • options.kind === "redirect"  → a delegated (e.g. OIDC) provider: top-level redirect to options.authorizeUrl;
//     the provider's hosted login runs the ceremony and redirects back here with its return params (?code&state),
//     which this page POSTs to the UNCHANGED /handoff/auth/verify as the opaque `assertion`.
//   • else (no `kind`)             → the in-page WebAuthn ceremony, UNCHANGED:
//       1. POST /handoff/auth/options → authentication options (a challenge) scoped to the enrolled credential
//       2. navigator.credentials.get(options) → the OS passkey UI → an assertion
//       3. POST /handoff/auth/verify (grant + path + assertion) → the gateway verifies + AUTHORIZES the grant
//   In BOTH cases: 4. open a WebSocket to the route path (carrying the grant) → the gateway proxies it to noVNC.
// All TRUST decisions are server-side at the gateway (grant verify, assertion verify, assurance policy). The page
// only starts the ceremony and POSTs results. base64url<->ArrayBuffer conversion is inline (no deps).
//
// REDIRECT-FLOW NOTES (the security-relevant choices; see docs/architecture, the dual-method-flow design §5):
//   • redirect target integrity — the page navigates ONLY to `options.authorizeUrl`, a value the SERVER built from
//     operator config + a fixed redirect_uri (adapters/.../oidc.ts buildAuthorizeUrl). NO request/URL parameter can
//     influence it, so this is not an open redirect. (The return arm only POSTs to a fixed same-origin path.)
//   • the GLA grant is NEVER handed to the provider — it is held in same-origin sessionStorage across the redirect
//     and read back on return; the provider only ever receives its own `?code&state`. The grant is re-verified
//     server-side on the return POST like any other request (the page cannot bypass the grant check).
//   • the browser-side redirect/return path is exercised end-to-end by the GLA-076 E2E; the gateway tests drive the
//     UNCHANGED verify route in-process.

/**
 * Render the handoff step-up page HTML. The grant token + the route path are embedded so the page's fetches and the
 * WS upgrade carry them; both are still verified server-side on every request (the page cannot bypass the grant
 * check — GLA-035). `recipientLabel` is a display-only hint (the binding is the grant's recipient caveat the server
 * reads from the signed grant).
 */
export function handoffPageHtml(grant: string, routePath: string, recipientLabel: string): string {
  // JSON-encoded data island (safe: JSON.stringify escapes quotes; the values are a base64url token, an opaque
  // path, and an opaque recipient ref — none containing `</script`).
  const data = JSON.stringify({ grant, path: routePath, recipient: recipientLabel });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify to continue — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.4rem; border: 1px solid #888; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
  #screen { margin-top: 1rem; width: 100%; }
</style>
</head>
<body>
<h1>Verify to continue</h1>
<p>Confirm it's you with your passkey to open the secure session that was shared with you.</p>
<button id="go">Verify with passkey</button>
<div id="status" role="status" aria-live="polite"></div>
<canvas id="screen" width="1024" height="768" hidden></canvas>
<script id="handoff-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("handoff-data").textContent);
  const btn = document.getElementById("go");
  const status = document.getElementById("status");
  const say = (msg, cls) => { status.textContent = msg; status.className = cls || ""; };

  // ── base64url <-> ArrayBuffer (no dependency) ──
  const b64urlToBuf = (s) => {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  };
  const bufToB64url = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  };

  // Convert the server's PublicKeyCredentialRequestOptionsJSON into the binary form get() needs.
  const toGetOptions = (o) => {
    const pk = { challenge: b64urlToBuf(o.challenge) };
    if (o.rpId) pk.rpId = o.rpId;
    if (o.timeout) pk.timeout = o.timeout;
    if (o.userVerification) pk.userVerification = o.userVerification;
    if (Array.isArray(o.allowCredentials)) {
      pk.allowCredentials = o.allowCredentials.map((c) => ({ id: b64urlToBuf(c.id), type: "public-key", ...(c.transports ? { transports: c.transports } : {}) }));
    }
    return pk;
  };

  // Serialize the browser's PublicKeyCredential into the AuthenticationResponseJSON the server verifies.
  const credToJson = (cred) => ({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      authenticatorData: bufToB64url(cred.response.authenticatorData),
      signature: bufToB64url(cred.response.signature),
      ...(cred.response.userHandle ? { userHandle: bufToB64url(cred.response.userHandle) } : {}),
    },
  });

  // Open the noVNC stream over the gateway's authorized WS upgrade (the gateway proxies it to the capsule). ctx
  // supplies the route path + grant (cfg for the in-page arm; the restored values on the redirect-return arm).
  const openStreamFor = (ctx) => {
    const c = ctx || cfg;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + location.host + c.path + "?grant=" + encodeURIComponent(c.grant);
    try {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => say("✓ Connected. The secure session is now open.", "ok");
      ws.onclose = () => say("The session was closed.", "err");
    } catch (e) {
      say("Could not open the session.", "err");
    }
  };

  // POST an opaque assertion to the UNCHANGED /handoff/auth/verify and, on success, open the stream. Shared by the
  // in-page ceremony (a WebAuthn assertion) and the redirect-return arm (the provider's {code,state} return params).
  // ctx supplies the grant+path: cfg for the in-page ceremony, or the sessionStorage-restored values on return.
  const submitAssertion = async (assertion, ctx) => {
    const c = ctx || cfg;
    say("Verifying…");
    const verRes = await fetch("/handoff/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: c.grant, path: c.path, assertion: assertion }),
    });
    const ver = await verRes.json().catch(() => ({}));
    if (verRes.ok && ver.authorized) {
      say("✓ Verified. Opening the secure session…", "ok");
      // The stream opens against the restored route/grant (same-origin), regardless of which arm completed.
      openStreamFor(c);
      return true;
    }
    say("Verification was not completed — try again.", "err");
    return false;
  };

  // ── Redirect-return arm: if this load carries a delegated provider's return params (?code&state), the ceremony
  //    happened at the provider and we are back. Restore the grant+path from SAME-ORIGIN sessionStorage (they were
  //    NEVER sent to the provider) and re-POST {code,state} to the UNCHANGED verify route as the opaque assertion.
  //    The server re-verifies the grant and gates by strength exactly as for an in-page assertion.
  const params = new URLSearchParams(location.search);
  const retCode = params.get("code");
  const retState = params.get("state");
  if (retCode && retState) {
    btn.disabled = true;
    let ctx = null;
    try { ctx = JSON.parse(sessionStorage.getItem("gla.handoff") || "null"); } catch (e) {}
    try { sessionStorage.removeItem("gla.handoff"); } catch (e) {}
    // Clean the return params out of the address bar so a reload doesn't replay them (the server burns state anyway).
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    if (ctx && ctx.grant && ctx.path) {
      submitAssertion({ code: retCode, state: retState }, ctx).then((ok) => { if (!ok) btn.disabled = false; });
    } else {
      // No preserved context (e.g. a fresh tab) — cannot complete; show the generic retry.
      say("Verification was not completed — try again.", "err");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    say("Requesting a verification challenge…");
    try {
      const optRes = await fetch("/handoff/auth/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: cfg.grant, path: cfg.path }),
      });
      if (!optRes.ok) {
        say("This link is invalid, has expired, or you are not the intended recipient.", "err");
        return;
      }
      const options = await optRes.json();
      // PROVIDER-AGNOSTIC completion branch on the opaque options' SHAPE (a generic kind discriminant — no provider
      // name, endpoint, or method here). A delegated provider returns {kind:"redirect", authorizeUrl}; WebAuthn options
      // have no kind and fall through to the UNCHANGED in-page ceremony below.
      if (options && options.kind === "redirect") {
        // Preserve the grant/path SAME-ORIGIN across the top-level redirect (NOT in the redirect_uri the provider sees).
        try { sessionStorage.setItem("gla.handoff", JSON.stringify({ grant: cfg.grant, path: cfg.path })); } catch (e) {}
        say("Redirecting you to sign in…");
        // Navigate ONLY to the server-built authorizeUrl (operator config + fixed redirect_uri) — no request input.
        location.assign(options.authorizeUrl);
        return;
      }
      say("Follow your device's prompt to verify…");
      const cred = await navigator.credentials.get({ publicKey: toGetOptions(options) });
      if (!cred) { say("Verification was not completed — try again.", "err"); btn.disabled = false; return; }
      const ok = await submitAssertion(credToJson(cred));
      if (!ok) btn.disabled = false;
    } catch (err) {
      // A cancelled/failed ceremony lands here — nothing was authorized server-side; let the user retry.
      say("Verification was not completed — try again.", "err");
      btn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

/**
 * Render the handoff REUSED-AUTH page (scenario-01 Phase 12, GLA-050/051): the recipient's prior step-up is still
 * valid, so there is NO WebAuthn ceremony — the page opens the noVNC stream over the gateway's authorized WS upgrade
 * DIRECTLY (the gateway already authorized this grant by reuse). It is the second window with "auth still valid, no
 * re-prompt." The grant + path are embedded for the WS upgrade (still verified server-side). The recipient sees no
 * prompt — the session opens straight away.
 */
export function handoffReusedPageHtml(
  grant: string,
  routePath: string,
  recipientLabel: string,
): string {
  const data = JSON.stringify({ grant, path: routePath, recipient: recipientLabel });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening your secure session — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
  #screen { margin-top: 1rem; width: 100%; }
</style>
</head>
<body>
<h1>Opening your secure session</h1>
<p>You're already verified — opening the session that was shared with you. No need to confirm again.</p>
<div id="status" role="status" aria-live="polite">Connecting…</div>
<canvas id="screen" width="1024" height="768" hidden></canvas>
<script id="handoff-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("handoff-data").textContent);
  const status = document.getElementById("status");
  const say = (msg, cls) => { status.textContent = msg; status.className = cls || ""; };
  // No ceremony — auth was reused. Open the noVNC stream over the gateway's already-authorized WS upgrade directly.
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = proto + "//" + location.host + cfg.path + "?grant=" + encodeURIComponent(cfg.grant);
  try {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => say("✓ Connected. The secure session is now open.", "ok");
    ws.onclose = () => say("The session was closed.", "err");
  } catch (e) {
    say("Could not open the session.", "err");
  }
})();
</script>
</body>
</html>`;
}

/** A minimal refusal page (HTML) shown when the handoff grant is absent/invalid/expired/wrong-recipient/revoked. */
export function handoffRefusalHtml(reason: string, message?: string): string {
  const msg =
    message ?? "This link is invalid, has expired, or you are not the intended recipient.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Link unavailable — GLA</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}.err{color:#b3261e}</style>
</head><body>
<h1>This link is unavailable</h1>
<p class="err">${msg}</p>
<p style="color:#888;font-size:.85rem">(${reason})</p>
</body></html>`;
}
