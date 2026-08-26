// The enrollment web page served by the Access Gateway on a valid operator-discharge grant (Phase E).
// A minimal, framework-free HTML+JS page (no build step). Like the handoff page, the COMPLETION MECHANISM is chosen
// by the SHAPE of the opaque options the gateway returns from /enroll/options — a PROVIDER-AGNOSTIC `kind`
// discriminant (NO provider name/endpoint/method anywhere in this file):
//   • options.kind === "redirect"  → a delegated (e.g. OIDC) provider: top-level redirect to options.authorizeUrl;
//     the provider's hosted flow runs the ceremony and redirects back here with its return params (?code&state),
//     which this page POSTs to the UNCHANGED /enroll/verify as the opaque `attestation`.
//   • else (no `kind`)             → the in-page WebAuthn registration ceremony, UNCHANGED:
//       1. POST /enroll/options → registration options (a challenge), bound to the recipient
//       2. navigator.credentials.create(options) → the OS passkey UI → an attestation
//       3. POST /enroll/verify (attestation) → the gateway resolves the bootstrap ticket, verifies + stores + marks spent
// All TRUST decisions are server-side at the gateway (grant verify, attestation verify, single-use). The page only
// starts the ceremony and POSTs results. base64url<->ArrayBuffer conversion is inline (no deps).
//
// REDIRECT-FLOW NOTES (same as the handoff page; see docs/architecture, the dual-method-flow design §5): nav ONLY to
// the SERVER-built `options.authorizeUrl` (operator config + fixed redirect_uri — no request input → no open
// redirect); the operator-discharge grant is held server-side behind a same-origin HttpOnly bootstrap ticket
// (never sent to the provider or browser storage) and re-verified server-side on the return POST; the browser
// redirect/return path is exercised by the GLA-076 E2E (the gateway tests drive the UNCHANGED verify route in-process).

import { htmlText, jsonScriptData } from "./html-safety.js";

/** Same-origin sessionStorage marker for a delegated enrollment redirect; it never carries the raw GLA grant. */
export const ENROLL_REDIRECT_STORAGE_KEY = "gla.enroll";

/** Same-origin public paths the enrollment page calls back into. */
export interface EnrollPagePaths {
  /** Same-origin path for the provider/enrollment options request. */
  readonly options: string;
  /** Same-origin path for the enrollment completion request. */
  readonly verify: string;
}

const ROOT_ENROLL_PATHS: EnrollPagePaths = {
  options: "/enroll/options",
  verify: "/enroll/verify",
};

/**
 * Render the enrollment page HTML. The raw grant is not embedded in the page; browser POSTs are bound by a
 * same-origin HttpOnly bootstrap ticket that the gateway resolves server-side. `recipientLabel` is a display-only
 * hint (the actual recipient is bound in the grant the server verifies). `paths` are same-origin public paths
 * already joined against `GLA_PUBLIC_BASE_URL`; the page does no deployment-specific path math.
 */
export function enrollPageHtml(
  recipientLabel: string,
  paths: EnrollPagePaths = ROOT_ENROLL_PATHS,
): string {
  // Escape HTML-significant bytes too: recipient labels and future provider metadata are not trusted.
  const data = jsonScriptData({ recipient: recipientLabel, paths });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Complete enrollment — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.4rem; border: 1px solid #888; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
</style>
</head>
<body>
<h1>Complete enrollment</h1>
<p>Set up the sign-in method configured for this GLA deployment so you can securely open handoff links sent to you. This is a one-time setup.</p>
<button id="go">Start enrollment</button>
<div id="status" role="status" aria-live="polite"></div>
<script id="enroll-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("enroll-data").textContent);
  try { if (new URLSearchParams(location.search).has("grant")) history.replaceState(null, "", location.pathname); } catch (e) {}
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

  // Convert the server's PublicKeyCredentialCreationOptionsJSON into the binary form create() needs.
  const toCreateOptions = (o) => {
    const pk = { ...o };
    pk.challenge = b64urlToBuf(o.challenge);
    pk.user = { ...o.user, id: b64urlToBuf(o.user.id) };
    if (Array.isArray(o.excludeCredentials)) {
      pk.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
    }
    return pk;
  };

  // Serialize the browser's PublicKeyCredential into the RegistrationResponseJSON the server verifies.
  const credToJson = (cred) => ({
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: {
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      attestationObject: bufToB64url(cred.response.attestationObject),
      transports: cred.response.getTransports ? cred.response.getTransports() : [],
    },
  });

  // POST an opaque attestation to the UNCHANGED verify route; on success show the enrolled state. Shared by the
  // in-page ceremony (a WebAuthn attestation) and the redirect-return arm (the provider's {code,state} params).
  const submitAttestation = async (attestation) => {
    say("Verifying…");
    const verRes = await fetch(cfg.paths.verify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attestation: attestation }),
    });
    const ver = await verRes.json().catch(() => ({}));
    if (verRes.ok && ver.enrolled) {
      say("✓ Enrolled. You can close this window.", "ok");
      return true;
    }
    say("Registration was not completed — try again.", "err");
    return false;
  };

  // ── Redirect-return arm: a delegated provider returned with ?code&state. Confirm this browser started a
  //    same-origin enrollment redirect and re-POST {code,state} to the UNCHANGED /enroll/verify as the opaque
  //    attestation. The server resolves the HttpOnly bootstrap ticket and re-verifies+consumes the grant.
  const params = new URLSearchParams(location.search);
  const retCode = params.get("code");
  const retState = params.get("state");
  if (retCode && retState) {
    btn.disabled = true;
    let marker = null;
    try { marker = sessionStorage.getItem("${ENROLL_REDIRECT_STORAGE_KEY}"); } catch (e) {}
    try { sessionStorage.removeItem("${ENROLL_REDIRECT_STORAGE_KEY}"); } catch (e) {}
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    if (marker) {
      submitAttestation({ code: retCode, state: retState }).then((ok) => { if (!ok) btn.disabled = false; });
    } else {
      say("Registration was not completed — try again.", "err");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    say("Requesting registration options…");
    try {
      const optRes = await fetch(cfg.paths.options, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!optRes.ok) {
        const e = await optRes.json().catch(() => ({}));
        say("This enrollment link is invalid or has already been used. Ask the operator for a new one.", "err");
        return;
      }
      const options = await optRes.json();
      // PROVIDER-AGNOSTIC completion branch on the opaque options' SHAPE (a generic kind — no provider name/method).
      // A delegated provider returns {kind:"redirect", authorizeUrl}; WebAuthn options have no kind and fall through
      // to the UNCHANGED in-page ceremony below.
      if (options && options.kind === "redirect") {
        try { sessionStorage.setItem("${ENROLL_REDIRECT_STORAGE_KEY}", "pending"); } catch (e) {}
        say("Redirecting you to sign in…");
        location.assign(options.authorizeUrl); // server-built target only — no request input → no open redirect.
        return;
      }
      say("Follow your device's prompt to create a passkey…");
      const cred = await navigator.credentials.create({ publicKey: toCreateOptions(options) });
      if (!cred) { say("Registration was not completed — try again.", "err"); btn.disabled = false; return; }
      const ok = await submitAttestation(credToJson(cred));
      if (!ok) btn.disabled = false;
    } catch (err) {
      // A cancelled/failed ceremony lands here — nothing was stored server-side; let the user retry.
      say("Registration was not completed — try again.", "err");
      btn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}

/** A minimal refusal page (HTML) shown when the grant is absent/invalid/expired/reused — a stable message. */
export function refusalPageHtml(reason: string): string {
  const safeReason = htmlText(reason);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Enrollment unavailable — GLA</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}.err{color:#b3261e}</style>
</head><body>
<h1>Enrollment link unavailable</h1>
<p class="err">This enrollment link is invalid or has already been used. Ask the operator for a new one.</p>
<p style="color:#888;font-size:.85rem">(${safeReason})</p>
</body></html>`;
}
