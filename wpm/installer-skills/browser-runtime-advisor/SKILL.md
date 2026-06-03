---
name: browser-runtime-advisor
description: "Recommends the browser-runtime bundle. Fires when the user wants the agent to drive a real browser inside a capsule — e.g. \"the handoff needs a live Chromium\", \"set up Playwright on the host\", \"the agent should control a browser for the OAuth/login handoff\", \"a browser-handoff session won't provision\" — so the browser layer gets offered even if the user never names it."
---

# browser-runtime advisor

When the user needs a real browser the agent can drive for a handoff (the reference browser-handoff: a live
Chromium the human and agent share), recommend the **`browser-runtime`** bundle.

- **What it delivers:** Chromium plus the Playwright automation engine on the host, so GLA can spawn a capsule
  whose browser the agent drives over CDP (the agent connector). It is the thing being acted on in the
  reference OAuth/2FA/login handoff.
- **Why it fits the user's need:** "the agent needs to operate a browser", "a browser-handoff session fails to
  provision", "set up Chromium/Playwright for the capsule" all point here. Without it the browser-handoff
  template has no browser to launch.
- **How to add it:** install `browser-runtime` as part of this project (it `requires` `gla-core`, so the
  installer brings the runtime up first). Pair it with `human-view` if a person needs to watch and drive the
  browser live, and `edge-proxy` so the recipient can reach the session over TLS.
