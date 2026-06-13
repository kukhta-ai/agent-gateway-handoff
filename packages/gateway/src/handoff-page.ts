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

/** Browser-client requirements declared by a human-entrypoint provider. */
export interface HandoffEntrypointClient {
  readonly kind: string;
  readonly ref?: string;
  readonly bootstrap?: Record<string, unknown>;
}

const DEFAULT_HANDOFF_CLIENT: HandoffEntrypointClient = { kind: "unconfigured" };
const DEFAULT_CLIENT_ASSETS_PATH = "/handoff/client-assets";

export function jsonScriptData(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Same-origin public paths and client binding the handoff page calls back into. */
export interface HandoffPagePaths {
  /** Same-origin path for the step-up options request. */
  readonly authOptions: string;
  /** Same-origin path for the step-up completion request. */
  readonly authVerify: string;
  /** Same-origin path for the WebSocket upgrade route as seen by the recipient's browser. */
  readonly stream: string;
  /** Same-origin path prefix serving provider-owned browser-client assets. */
  readonly clientAssets?: string;
  /** Provider-declared browser-client binding for this entrypoint. */
  readonly entrypointClient?: HandoffEntrypointClient;
}

const ROOT_HANDOFF_PATHS = (routePath: string): HandoffPagePaths => ({
  authOptions: "/handoff/auth/options",
  authVerify: "/handoff/auth/verify",
  stream: routePath,
  clientAssets: DEFAULT_CLIENT_ASSETS_PATH,
});

export function handoffClientStyles(): string {
  return `
  .shell { max-width: min(96vw, 82rem); margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #1f2328; background: #f7f4ed; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.4rem; border: 1px solid #888; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
  #viewer {
    margin-top: 1rem;
    width: 100%;
    height: min(70vh, 760px);
    min-height: 360px;
    border: 1px solid #b8b1a4;
    border-radius: 0.65rem;
    overflow: hidden;
    background: #111;
  }
  #viewer:focus { outline: 3px solid #2f6fed; outline-offset: 2px; }
  #viewer canvas { width: 100%; height: auto; display: block; }
  #viewer[hidden] { display: none; }
  `;
}

export function handoffClientScript(): string {
  return `
  const cleanSegment = (value) => String(value || "").replace(/[^a-zA-Z0-9._-]/g, "");
  const cleanAssetPath = (value) => String(value || "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const browserStreamUrl = (ctx) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const streamPath = ctx.streamPath || ctx.path;
    return proto + "//" + location.host + streamPath + "?grant=" + encodeURIComponent(ctx.grant);
  };
  const assetModuleUrl = (ctx, modulePath) => {
    const client = ctx.client || {};
    const ref = cleanSegment(client.ref || "novnc");
    if (!ref) return undefined;
    const base = String(ctx.clientAssets || cfg.paths.clientAssets || "${DEFAULT_CLIENT_ASSETS_PATH}").replace(/\\/+$/, "");
    const mod = cleanAssetPath(modulePath || "core/rfb.js");
    if (!mod) return undefined;
    return base + "/" + encodeURIComponent(ref) + "/" + mod;
  };
  const openEntrypointClient = async (ctx) => {
    const client = (ctx && ctx.client) || {};
    if (client.kind !== "rfb-web-client") {
      say("Verified, but no browser viewer is configured for this handoff.", "err");
      return false;
    }
    const bootstrap = client.bootstrap || {};
    const moduleUrl = assetModuleUrl(ctx, bootstrap.module || "core/rfb.js");
    if (!moduleUrl) {
      say("The live browser viewer is unavailable: client assets are not configured.", "err");
      return false;
    }
    const viewer = document.getElementById("viewer");
    viewer.hidden = false;
    viewer.textContent = "";
    viewer.tabIndex = 0;
    say("✓ Verified. Opening the live browser viewer…", "ok");
    try {
      const mod = await import(moduleUrl);
      const RFB = mod.default || mod.RFB;
      if (typeof RFB !== "function") {
        say("The live browser viewer is unavailable: client module is invalid.", "err");
        return false;
      }
      const rfb = new RFB(viewer, browserStreamUrl(ctx), { credentials: bootstrap.credentials || {} });
      rfb.scaleViewport = bootstrap.scaleViewport !== false;
      rfb.resizeSession = bootstrap.resizeSession === true;
      rfb.viewOnly = bootstrap.viewOnly === true;
      if ("focusOnClick" in rfb) rfb.focusOnClick = true;
      rfb.addEventListener("connect", () => {
        try { viewer.focus(); } catch (e) {}
        try { if (typeof rfb.focus === "function") rfb.focus(); } catch (e) {}
        say("✓ Connected to the live browser.", "ok");
      });
      rfb.addEventListener("disconnect", (event) => {
        const clean = Boolean(event && event.detail && event.detail.clean);
        say(clean ? "The session was closed." : "The live browser viewer is unavailable.", clean ? "" : "err");
      });
      rfb.addEventListener("securityfailure", () => {
        say("The live browser viewer refused the connection.", "err");
      });
      return true;
    } catch (e) {
      say("The live browser viewer is unavailable.", "err");
      return false;
    }
  };
`;
}

/**
 * Render the handoff step-up page HTML. The grant token + the INTERNAL route path are embedded so auth POST bodies
 * preserve the grant scope; `paths.stream` is the PUBLIC same-origin route path the browser connects to. Both are
 * still verified server-side on every request (the page cannot bypass the grant check — GLA-035). `recipientLabel`
 * is a display-only hint (the binding is the grant's recipient caveat the server reads from the signed grant).
 */
export function handoffPageHtml(
  grant: string,
  routePath: string,
  recipientLabel: string,
  paths: HandoffPagePaths = ROOT_HANDOFF_PATHS(routePath),
): string {
  // JSON-encoded data island. Escape HTML-significant bytes too: provider bootstrap metadata is not trusted.
  const data = jsonScriptData({
    grant,
    path: routePath,
    streamPath: paths.stream,
    recipient: recipientLabel,
    paths,
    client: paths.entrypointClient ?? DEFAULT_HANDOFF_CLIENT,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify to continue — GLA</title>
<style>
${handoffClientStyles()}
</style>
</head>
<body>
<main class="shell">
<h1>Verify to continue</h1>
<p>Confirm it's you with your passkey to open the secure session that was shared with you.</p>
<button id="go">Verify with passkey</button>
<div id="status" role="status" aria-live="polite"></div>
<div id="viewer" aria-label="Live secure browser viewport" hidden></div>
</main>
<script id="handoff-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("handoff-data").textContent);
  const btn = document.getElementById("go");
  const status = document.getElementById("status");
  const say = (msg, cls) => { status.textContent = msg; status.className = cls || ""; };
${handoffClientScript()}

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

  // POST an opaque assertion to the UNCHANGED /handoff/auth/verify and, on success, open the stream. Shared by the
  // in-page ceremony (a WebAuthn assertion) and the redirect-return arm (the provider's {code,state} return params).
  // ctx supplies the grant+path: cfg for the in-page ceremony, or the sessionStorage-restored values on return.
  const submitAssertion = async (assertion, ctx) => {
    const c = ctx || cfg;
    say("Verifying…");
    const verRes = await fetch(cfg.paths.authVerify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: c.grant, path: c.path, assertion: assertion }),
    });
    const ver = await verRes.json().catch(() => ({}));
    if (verRes.ok && ver.authorized) {
      // The provider-declared browser client opens against the restored route/grant (same-origin), regardless of
      // which arm completed. The page never treats a raw WebSocket open as a visible live browser.
      await openEntrypointClient(c);
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
      const optRes = await fetch(cfg.paths.authOptions, {
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
        try { sessionStorage.setItem("gla.handoff", JSON.stringify({ grant: cfg.grant, path: cfg.path, streamPath: cfg.streamPath, client: cfg.client, clientAssets: cfg.paths.clientAssets })); } catch (e) {}
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
 * valid, so there is NO WebAuthn ceremony — the page opens the entrypoint stream over the gateway's authorized WS upgrade
 * DIRECTLY (the gateway already authorized this grant by reuse). It is the second window with "auth still valid, no
 * re-prompt." The grant + path are embedded for the WS upgrade (still verified server-side). The recipient sees no
 * prompt — the session opens straight away.
 */
export function handoffReusedPageHtml(
  grant: string,
  routePath: string,
  recipientLabel: string,
  streamPath: string = routePath,
  entrypointClient: HandoffEntrypointClient = DEFAULT_HANDOFF_CLIENT,
  clientAssets: string = DEFAULT_CLIENT_ASSETS_PATH,
): string {
  const data = jsonScriptData({
    grant,
    path: routePath,
    streamPath,
    recipient: recipientLabel,
    client: entrypointClient,
    clientAssets,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening your secure session — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
${handoffClientStyles()}
</style>
</head>
<body>
<main class="shell">
<h1>Opening your secure session</h1>
<p>You're already verified — opening the session that was shared with you. No need to confirm again.</p>
<div id="status" role="status" aria-live="polite">Connecting…</div>
<div id="viewer" aria-label="Live secure browser viewport" hidden></div>
</main>
<script id="handoff-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("handoff-data").textContent);
  const status = document.getElementById("status");
  const say = (msg, cls) => { status.textContent = msg; status.className = cls || ""; };
${handoffClientScript()}
  // No ceremony — auth was reused. Open the provider-declared browser client over the already-authorized route.
  void openEntrypointClient(cfg);
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
