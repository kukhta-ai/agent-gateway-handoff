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
//       3. POST /enroll/verify (grant + attestation) → the gateway verifies + stores + marks spent
// All TRUST decisions are server-side at the gateway (grant verify, attestation verify, single-use). The page only
// starts the ceremony and POSTs results. base64url<->ArrayBuffer conversion is inline (no deps).
//
// REDIRECT-FLOW NOTES (same as the handoff page; see docs/architecture, the dual-method-flow design §5): nav ONLY to
// the SERVER-built `options.authorizeUrl` (operator config + fixed redirect_uri — no request input → no open
// redirect); the operator-discharge grant is held SAME-ORIGIN in sessionStorage across the redirect (never sent to
// the provider) and re-verified server-side on the return POST; the browser redirect/return path is exercised by
// the GLA-076 E2E (the gateway tests drive the UNCHANGED verify route in-process).

/**
 * Render the enrollment page HTML. The grant token is embedded so the page's fetches carry it; it is also still
 * verified server-side on every POST (the page cannot bypass the grant check — GLA-012 AC#2). `recipientLabel` is
 * a display-only hint (the actual recipient is bound in the grant the server verifies).
 */
export function enrollPageHtml(grant: string, recipientLabel: string): string {
  // The grant + label are JSON-encoded into a <script> data island (safe: JSON.stringify escapes quotes; the
  // values are a base64url token and an opaque recipient ref, neither containing `</script`).
  const data = JSON.stringify({ grant, recipient: recipientLabel });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Register your passkey — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 0.4rem; border: 1px solid #888; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
</style>
</head>
<body>
<h1>Register your passkey</h1>
<p>Set up a passkey so you can securely open handoff links sent to you. This is a one-time setup.</p>
<button id="go">Register passkey</button>
<div id="status" role="status" aria-live="polite"></div>
<script id="enroll-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("enroll-data").textContent);
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

  // POST an opaque attestation to the UNCHANGED /enroll/verify; on success show the enrolled state. Shared by the
  // in-page ceremony (a WebAuthn attestation) and the redirect-return arm (the provider's {code,state} params).
  const submitAttestation = async (attestation, grant) => {
    say("Verifying…");
    const verRes = await fetch("/enroll/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: grant, attestation: attestation }),
    });
    const ver = await verRes.json().catch(() => ({}));
    if (verRes.ok && ver.enrolled) {
      say("✓ Enrolled. You can close this window.", "ok");
      return true;
    }
    say("Registration was not completed — try again.", "err");
    return false;
  };

  // ── Redirect-return arm: a delegated provider returned with ?code&state. Restore the grant from SAME-ORIGIN
  //    sessionStorage (never sent to the provider) and re-POST {code,state} to the UNCHANGED /enroll/verify as the
  //    opaque attestation. The server re-verifies+consumes the grant exactly as for an in-page attestation.
  const params = new URLSearchParams(location.search);
  const retCode = params.get("code");
  const retState = params.get("state");
  if (retCode && retState) {
    btn.disabled = true;
    let g = null;
    try { g = sessionStorage.getItem("gla.enroll"); } catch (e) {}
    try { sessionStorage.removeItem("gla.enroll"); } catch (e) {}
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    if (g) {
      submitAttestation({ code: retCode, state: retState }, g).then((ok) => { if (!ok) btn.disabled = false; });
    } else {
      say("Registration was not completed — try again.", "err");
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    say("Requesting registration options…");
    try {
      const optRes = await fetch("/enroll/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: cfg.grant }),
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
        try { sessionStorage.setItem("gla.enroll", cfg.grant); } catch (e) {}
        say("Redirecting you to sign in…");
        location.assign(options.authorizeUrl); // server-built target only — no request input → no open redirect.
        return;
      }
      say("Follow your device's prompt to create a passkey…");
      const cred = await navigator.credentials.create({ publicKey: toCreateOptions(options) });
      if (!cred) { say("Registration was not completed — try again.", "err"); btn.disabled = false; return; }
      const ok = await submitAttestation(credToJson(cred), cfg.grant);
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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Enrollment unavailable — GLA</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}.err{color:#b3261e}</style>
</head><body>
<h1>Enrollment link unavailable</h1>
<p class="err">This enrollment link is invalid or has already been used. Ask the operator for a new one.</p>
<p style="color:#888;font-size:.85rem">(${reason})</p>
</body></html>`;
}
