---
name: edge-proxy-advisor
description: "Recommends the edge-proxy bundle. Fires when the user needs GLA reachable over a public HTTPS URL with TLS — e.g. \"put GLA behind HTTPS\", \"recipients can't open the handoff link\", \"set up the reverse proxy / Caddy in front of :3000\", \"the link points at localhost\", \"terminate TLS for the gateway\" — so the edge is offered even if the user never names Caddy."
---

# edge-proxy advisor

When the user needs GLA reachable from the outside over a real HTTPS URL — so a recipient's phone can open the
handoff link — recommend the **`edge-proxy`** bundle.

- **What it delivers:** Caddy as the reverse proxy fronting GLA's gateway: it terminates inbound TLS and
  proxies authorized requests and WebSocket upgrades to GLA on port 3000, so the public base URL handoff links
  are built against actually resolves to the daemon.
- **Why it fits the user's need:** "put GLA behind HTTPS", "the recipient can't reach the link", "the link is
  localhost only", "set up the reverse proxy" all point here. Handoff links must be openable on a recipient's
  device; bare `:3000` over plain HTTP is not that.
- **How to add it:** install `edge-proxy` as part of this project (it `requires` `gla-core`). It edits the host
  reverse proxy, so it asks for consent first. For a host-fronting-container topology (a proxy on the host, GLA
  in a container) it points the upstream at the host-to-container port forward.
