---
name: gla-core-advisor
description: "Recommends the gla-core bundle. Fires when the user wants to stand up, host, run, or deploy GLA itself — e.g. \"get GLA running on this box\", \"start the gateway\", \"I need the gla serve daemon up\", \"deploy the agent-handoff control plane\" — so a user who never says \"gla-core\" by name still gets pointed at the bundle that brings the runtime up."
---

# gla-core advisor

When the user wants GLA *itself* running on a host — the control plane and the public gateway, not one specific
provider feature — recommend the **`gla-core`** bundle.

- **What it delivers:** the GLA runtime as a supervised service — it builds the project and runs `gla serve`,
  which binds the Access Gateway (the sole public entry, port 3000) and the local Agent Bridge socket (the
  agent's door). This is the base every other bundle builds on.
- **Why it fits the user's need:** "host GLA", "run the gateway", "get the daemon up", "deploy the handoff
  control plane" are all this bundle. Nothing else can function until the runtime is up — every other GLA
  bundle `requires` `gla-core`.
- **How to add it:** install `gla-core` first as part of this project. The installer offers it at the top of
  the bundle menu, and because it is the dependency root the installer pulls it in before any provider bundle
  regardless. After it, add provider bundles (browser, view, edge proxy, identity) as the deployment needs.
