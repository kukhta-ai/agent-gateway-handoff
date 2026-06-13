import { ENROLL_REDIRECT_STORAGE_KEY } from "./enroll-page.js";

/** Same-origin public paths the delegated-auth callback page calls back into. */
export interface AuthCallbackPagePaths {
  /** Same-origin path for enrollment completion. */
  readonly enrollVerify: string;
  /** Same-origin path for handoff step-up completion. */
  readonly handoffVerify: string;
}

/**
 * Render the delegated-auth callback landing page.
 *
 * The page is provider-neutral: it only sees opaque OIDC-style return parameters (`code`/`state`) and restores the
 * GLA grant from same-origin sessionStorage written by the enroll/handoff page before redirecting. The grant never
 * appears in the IdP-facing redirect URI.
 */
export function authCallbackPageHtml(paths: AuthCallbackPagePaths): string {
  const data = JSON.stringify({ paths });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Completing sign-in — GLA</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  #status { margin-top: 1rem; min-height: 1.5rem; }
  .ok { color: #137333; } .err { color: #b3261e; }
  #screen { margin-top: 1rem; width: 100%; }
</style>
</head>
<body>
<h1>Completing sign-in</h1>
<p>Returning to your secure GLA session.</p>
<div id="status" role="status" aria-live="polite">Verifying…</div>
<canvas id="screen" width="1024" height="768" hidden></canvas>
<script id="callback-data" type="application/json">${data}</script>
<script>
(() => {
  const cfg = JSON.parse(document.getElementById("callback-data").textContent);
  const status = document.getElementById("status");
  const say = (msg, cls) => { status.textContent = msg; status.className = cls || ""; };
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (code || state) {
    history.replaceState({}, document.title, location.pathname);
  }
  if (!code || !state) {
    say("The identity provider did not return the required code/state.", "err");
    return;
  }

  const readJson = (key) => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (e) {
      return undefined;
    }
  };
  const openStream = (ctx) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + location.host + ctx.streamPath + "?grant=" + encodeURIComponent(ctx.grant);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => say("✓ Connected. The secure session is now open.", "ok");
    ws.onclose = () => say("The session was closed.", "err");
  };
  const finishHandoff = async (ctx) => {
    const res = await fetch(cfg.paths.handoffVerify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: ctx.grant, path: ctx.path, assertion: { code, state } }),
    });
    if (!res.ok) {
      say("Verification was not completed. Ask the operator for a new link.", "err");
      return;
    }
    try { sessionStorage.removeItem("gla.handoff"); } catch (e) {}
    openStream(ctx);
  };
  const finishEnroll = async (grant) => {
    const res = await fetch(cfg.paths.enrollVerify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant, attestation: { code, state } }),
    });
    if (res.ok) {
      try { sessionStorage.removeItem("${ENROLL_REDIRECT_STORAGE_KEY}"); } catch (e) {}
      say("✓ Enrolled. You can close this window.", "ok");
      return;
    }
    say("Registration was not completed. Ask the operator for a new link.", "err");
  };

  const handoff = readJson("gla.handoff");
  if (handoff && handoff.grant && handoff.path && handoff.streamPath) {
    void finishHandoff(handoff);
    return;
  }
  let enrollGrant;
  try { enrollGrant = sessionStorage.getItem("${ENROLL_REDIRECT_STORAGE_KEY}"); } catch (e) {}
  if (enrollGrant) {
    void finishEnroll(enrollGrant);
    return;
  }
  say("No GLA session state was found for this callback. Re-open the original GLA link and try again.", "err");
})();
</script>
</body>
</html>`;
}
