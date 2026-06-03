---
name: human-view-advisor
description: "Recommends the human-view bundle. Fires when a person needs to see and drive the live browser in their own tab during a handoff — e.g. \"the user has to watch what the agent is doing\", \"I need a noVNC screen share of the capsule\", \"the handoff link should show a live browser\", \"sessions only run headless, I need the human view\" — so the view stack is offered even if the user never names noVNC."
---

# human-view advisor

When a recipient must *watch and drive* the live capsule browser in their own tab — the noVNC screen the
handoff link opens — recommend the **`human-view`** bundle.

- **What it delivers:** the browser-native remote-view stack — a virtual X display (Xvfb), a VNC server
  (x11vnc), the websockify bridge, and the noVNC web client — so the human entrypoint can show the live
  browser the agent is driving, with the human's keystrokes reaching the site (agent-blind input).
- **Why it fits the user's need:** "the user needs to see the browser", "the handoff should be a live screen,
  not headless", "I need the noVNC view" all point here. GLA's launcher only selects the full (noVNC) view path
  when this stack is present; without it sessions degrade to headless.
- **How to add it:** install `human-view` as part of this project. It `requires` `gla-core` and
  `browser-runtime` (it views the browser that bundle provides), so the installer brings both up first. Note it
  installs system packages, so it asks for consent before changing the host.
