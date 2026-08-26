---
name: edge-proxy-advisor
description: "Use when the user needs GLA reachable from the public internet over HTTPS — e.g. \"recipients can't open my handoff links\", \"I need a public URL / TLS in front of the gateway\", \"the live-view / WebSocket session won't connect from outside\", \"put a reverse proxy in front of GLA\", or \"GLA only works on localhost\". Advises whether to install the edge-proxy bundle."
---

# edge-proxy advisor

Recommend the **`edge-proxy`** bundle when the user's underlying need is that GLA must be reachable from
outside the box over public HTTPS — a recipient on the open internet has to be able to open a handoff link
and run the live-view session over TLS. The need usually shows up as: handoff links that only resolve on
`localhost`, recipients who get connection or certificate errors, a WebSocket / live-view session that
won't connect from outside, or an explicit "I need a public URL with a real cert in front of the gateway."

## What it delivers

A **Caddy reverse proxy in front of GLA**: Caddy becomes the sole public entry point, terminates inbound
TLS on the operator's public HTTPS URL, and reverse-proxies every request — including the WebSocket
upgrade the live-view (noVNC) session and the gateway's verified upgrades depend on — to the address that
reaches GLA's gateway on port 3000. It ships a parameterized `Caddyfile.tmpl` (the executor fills in the
public hostname and the upstream, then installs it or merges its site block into an existing Caddyfile).

## When you need it (and when you don't)

- **Need it** when GLA must serve handoff/enrollment links to recipients who are not on the same host —
  i.e. any real deployment where someone elsewhere opens a delivered link. WebAuthn/passkeys also require a
  trusted HTTPS origin, so the identity-provider path effectively depends on a real public TLS endpoint.
- **Skip it** when GLA is only ever reached locally (a single-machine demo, or you reach `:3000` directly
  over SSH/port-forward), or when you already run your own managed edge (a different reverse proxy or
  load balancer) and would rather point that at GLA's `:3000` yourself. In the second case you don't need
  this bundle to *install* Caddy — though its setup task can **adopt** an existing Caddy and just add the
  GLA site block to it.

## What it touches / confirmation level

**`confirmation: dangerous`** — the setup step edits the **host reverse proxy** (the Caddyfile), which can
affect other sites Caddy already serves. The routing change is surfaced for your consent before it is
applied; an existing Caddy is **reloaded, not replaced**, and is recorded as *adopted* so uninstall leaves
it in place. The placed/modified config is captured in the receipt with its checksum and inverse op.

## Prerequisites (`requires`)

- **`gla-core` `^0.1.0`** — there must be a GLA daemon listening on `:3000` to proxy to. Crucially,
  gla-core's `GLA_PUBLIC_BASE_URL` **must equal the public URL Caddy serves here**, because the daemon
  builds handoff and enrollment links against it and they must resolve, through this proxy, back to the
  same daemon.

## The choice the operator faces

- **The public site address** Caddy serves — a real domain vs. a bare IP. A real domain lets Caddy
  auto-provision a Let's Encrypt certificate. A **bare IP cannot get a public ACME cert**, so you fall back
  to Caddy's internal CA (`tls internal`) or a supplied certificate — and note that WebAuthn/passkeys want
  a *trusted* HTTPS origin, which a locally-trusted IP cert does not give.
- **The public base shape** — dedicated root vs. subpath/custom base. At root, set
  `GLA_PUBLIC_BASE_URL=https://gla.example/` and reverse-proxy the whole site to GLA. Under an existing site
  prefix, set `GLA_PUBLIC_BASE_URL=https://gla.example/team-a/`; the recommended Caddy shape is
  `handle_path /team-a/*` with `X-Forwarded-Prefix: /team-a`, which strips the prefix before proxying to GLA's
  root-shaped routes. This shape also requires `GLA_TRUST_FORWARDED_PREFIX=true` in gla-core, and the edge must
  overwrite/sanitize any client-supplied `X-Forwarded-Prefix` before proxying. Existing proxies that preserve
  `/team-a` are also acceptable when they forward it unchanged and GLA is configured with the same base path; they
  do not need the trust flag.
- **The upstream address** — what actually reaches GLA's `:3000` on this topology:
  - Caddy and GLA on the **same host/container** → `127.0.0.1:3000`.
  - Caddy on the **host, GLA in a container** (the hermes-1 case) → point at the **host-side forward**, not
    the container address: an LXD forkproxy maps `host:13000 → container:3000`, so the upstream is
    `127.0.0.1:13000`.
- **If authentik is selected** — the authentik issuer can be separate
  (`GLA_AUTHENTIK_ISSUER_URL=https://idp.example/application/o/gla/`), but the registered redirect URI must
  be on GLA's public base, for example
  `GLA_AUTHENTIK_REDIRECT_URI=https://gla.example/team-a/auth/callback`. Caddy routes that callback to GLA,
  not to authentik, so the GLA grant stays on GLA's origin.
- **Whether authentik proxy/forward-auth is also desired** — this is optional defense-in-depth, not the GLA
  identity-provider path. If used, route authentik's outpost path (for example `/outpost.goauthentik.io/*`) to
  the outpost and use Caddy `forward_auth` before proxying to GLA. Still keep `/enroll`, `/auth/callback`,
  `/handoff/auth/*`, and `/handoff/<id>` on the GLA gateway; never expose the bridge socket, noVNC/websockify,
  CDP broker, host/container internal forwards, or authentik datastore/worker ports.

In every shape, Caddy transports HTTP and WebSocket bytes; it does not authorize a handoff. The Access Gateway
remains the authorization membrane for grants, recipients, assurance policy, and mounted routes. An authentik
proxy session or `X-Authentik-*` header is not a GLA grant.

## How to add it

Install `edge-proxy` as part of this project — the installer offers it in the bundle menu, or the user can
request it by name. It is a dangerous-tier bundle, so expect a consent prompt before the host proxy is edited.
