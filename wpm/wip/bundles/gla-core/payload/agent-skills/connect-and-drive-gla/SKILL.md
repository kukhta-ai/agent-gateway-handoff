---
name: connect-and-drive-gla
description: "How an agent connects to a running GLA daemon and drives it. Use when you need to hand a step to a human through GLA — open a browser/login/secret/document/approval handoff and wait for the result — i.e. when you hit a wall only a person can clear and a GLA deployment is available to bridge it."
---

# connect-and-drive-gla

This is a **payload** skill the `gla-core` bundle delivers — runtime knowledge for the *using* agent (the one
that hits a wall and hands off to a human), not for the installer. It is inert in the repo and becomes live
when the install copies it into your scanned skill scope. It assumes the GLA daemon is already up (that is what
`gla-core` installs).

## When to reach for GLA

You are carrying a task and hit a step that is the human's to clear — a same-session OAuth/2FA login, a secret
you must never see, a document last-mile edit, a file-pick-by-content, a destructive-action approval, a live
app-preview. GLA opens a temporary, scoped, recipient-bound surface for exactly that moment and hands you back
a structured completion. You stay in control; the human acts inside the surface.

## Connect to the bridge

GLA has two doors; you use the **Agent Bridge** (local, unprivileged), never the public gateway. The bridge is
a local unix socket the daemon binds (default `$XDG_RUNTIME_DIR/gla.sock`, else `/run/gla.sock`). Point the
`gla` CLI at it and confirm your identity and authority:

```bash
export GLA_ENDPOINT=/run/user/$(id -u)/gla.sock   # the bridge socket the daemon bound (user-scope service)
gla whoami                                          # your agent identity + the operations your authority allows
```

`gla` speaks JSON by default (the agent contract): stdout is results, stderr is diagnostics, exit codes are a
stable taxonomy you branch on (0 ok; 3 admission/policy reject; 5 not found; 6 timeout; 8 dependency
unavailable; full list via `gla schema`). You never receive raw secrets — only a `secret_ref`.

## Orient, then assemble a session

Discover what *this* install offers rather than assuming; load the skill for the template you need; assemble a
**concrete** session (a delta over a trusted template — you fill only the cognition-shaped holes like the
success URL and recipient), dry-run it through admission, then provision:

```bash
gla template list                                   # the assemblable capsules this install offers
gla template show browser-handoff                   # required parts + each dependency's binding status
gla skill show browser-handoff                      # the recipe in prose, if present

gla session create -f assembly.json --dry-run       # admission check only (mutate defaults -> validate)
gla session create -f assembly.json                 # provision -> {session_id, connector:{cdp_url, secret_ref}}
```

The `connector` it returns (a CDP url for a browser capsule, a path, or a `secret_ref`) is your **work
channel** — you drive it with your own tooling (e.g. a CDP client), not through `gla` verbs. `gla` is the
control interface; the connector is where you do the in-capsule work.

## Hand off to the human and wait

Open a recipient-bound window onto the session (the link is delivered to the recipient through the channel),
then block until the human completes it or it expires:

```bash
H=$(gla handoff open --session "$SESS" --reason "complete the login" --fields handoff_id -q)
gla handoff wait "$H" --timeout 15m                 # blocks; returns the normalized completion envelope
```

You can open several handoffs onto the same live session in sequence (e.g. fill-the-form, then enter-the-code).
When the goal is done, tear it down:

```bash
gla task complete "$TASK"                            # reaps capsules, revokes capabilities
```

## Principles to honor

- **You are unprivileged.** The bridge never hands you the gateway admin API, a container socket, or a raw
  secret. Work within your `agent-authority`; the CLI enforces nothing extra and grants nothing extra.
- **Agent-blind by design.** Secrets are `secret_ref`s; the human's keystrokes reach the site, not you.
- **Errors carry a recovery pointer.** On a stable `error.code`, load the `skill` the error names rather than
  guessing — cognition stays with you, not the tool.
- **Durably wait and resume.** `handoff wait` is a long-poll; reads (`session get`, `handoff get`) let a
  crashed agent re-attach to a live session by id.
