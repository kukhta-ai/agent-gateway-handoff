---
name: isolation-advisor
description: "Recommends the isolation bundle. Fires when the user asks how capsules are isolated or wants stronger isolation — e.g. \"how are sessions sandboxed\", \"can capsules run in Docker\", \"I want container isolation for the browser\", \"is the process tier safe enough\", \"set the capsule isolation tier\" — so the tier decision is surfaced even if the user never names it."
---

# isolation advisor

When the user asks how a capsule is isolated, or wants to choose or strengthen the isolation tier, recommend
the **`isolation`** bundle.

- **What it delivers:** the choice and recording of the capsule isolation tier (the Spawner/Launcher tier). The
  **process tier is GLA's default** — it needs no isolation runtime beyond the browser and view layers — and
  **Docker is the stronger alternative** tier, offered when a usable daemon is present.
- **Why it fits the user's need:** "how are sessions sandboxed", "can I run capsules in containers", "pick the
  isolation tier", "is process isolation enough" all point here. It is where the process-tier-default decision
  is made explicit and where Docker is opted into.
- **How to add it:** install `isolation` as part of this project (it `requires` `gla-core`). For most
  single-operator deployments the process tier is the answer and needs no extra software; choose Docker only
  when stronger isolation is required and the host can run it reliably (note the nested-container caveat inside
  an unprivileged LXD container).
