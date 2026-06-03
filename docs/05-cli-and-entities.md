# 05 · CLI & the agent-facing entity model

This doc designs the `gla` command-line interface — the CLI variant of the Agent Bridge (see `components/agent-bridge.md`) — and, on the way, extracts the core entities a *agent-user* actually manipulates.

The framing that drives every decision: **for GLA the primary user of the CLI is an AI agent, not a human.** A CLI built for agents is a different contract from one built for people — and the industry has converged on what that contract is (clig.dev for the human baseline; the 2025–26 "rewrite your CLI for agents" wave — Speakeasy, Algolia, Google's Workspace CLI, the GitLab `glab` work — for the agent layer). It is also conveniently the same set of disciplines we already adopted for other reasons: the agent is untrusted, cognition lives in skills, and rejections are stable codes a skill interprets.

> The CLI and the MCP server are **two transports over the same primitives** (overview §, principle 11). Every noun-verb command here maps 1:1 to an MCP tool, and every read command maps to an MCP resource. Parity is an invariant: identical authority, validation, audit, and outcome on both surfaces.

---

## 1. Design stance & principles

**Agents-first, humans-welcome.** Structured JSON is the *default* output contract; a human-readable `text` mode is auto-selected only when stdout is a TTY. The agent never has to opt in to machine output.

**Resource-oriented (noun-verb).** `gla <noun> <verb> [args] [--flags]`. This turns capability discovery into a tree search: `gla --help` lists the nouns; `gla session --help` lists the verbs for sessions. It also keeps a 1:1 mapping to MCP tools.

**One root, consistent globals.** A single `gla` binary; global flags shared across all subcommands; consistent flag names; one-letter flags reserved for the few common ones; arguments and flags order-independent.

**stdout = results, stderr = diagnostics.** Success data goes to stdout as JSON (or NDJSON for streams). All human/progress/error messages go to stderr. The separation is absolute, so an agent can capture stdout and parse it blind.

**Stable, documented exit codes.** Not just 0/1 — a small taxonomy the agent branches on (§5). The richer signal is the JSON `error.code`; the exit code is the coarse branch.

**Self-describing at runtime.** `gla schema [<noun> [<verb>]]` returns the machine-readable surface (inputs, outputs, flags, exit codes); `gla <cmd> --help -o json` does the same per command. Agents introspect rather than read a README.

**Idempotent & resumable.** Reads are pure; `get`/`list` let a crashed agent re-attach to a live task/session. Mutations are safe to retry or clearly report a conflict (exit 7).

**No interactive prompts.** `--no-input` is the default off a TTY; the CLI never blocks an agent on a prompt. If a path genuinely needs a human, that is a *handoff* (a first-class GLA concept), not a terminal prompt.

**Token economy.** `--quiet` suppresses progress/spinners; `--fields a,b,c` trims output to a field mask; long or large results stream as NDJSON rather than buffering. Agents pay for every byte they read.

**Secrets discipline (and agent-blindness).** Secrets are never accepted on argv (they leak to process lists) — use env or stdin. The CLI never prints a raw secret; it prints a `secret_ref`. This is the agent-blind invariant enforced at the interface.

**Untrusted-client hardening.** The agent is not a trusted operator. The CLI validates inputs (rejects control characters, path traversal, embedded URLs) and — critically — grants *nothing* and enforces *nothing* on its own: it is a thin transport over the same server-side admission, policy, and capability checks. The CLI can never let the agent do more than its `agent-authority` capability already allows.

**Errors carry a recovery pointer, not advice.** An error is `{code, message, detail, skill, retryable}`. The stable namespaced `code` is the fact; the `skill` field names the skill the agent should load to reason about recovery. The CLI does not editorialize — cognition stays in the skill.

---

## 2. Core entities the agent manipulates (the synthesis)

Of everything in the architecture, only a handful of nouns are things the *agent* acts on or reads. The rest (capabilities, routes, completion detectors, grants, bindings) are internal mechanisms the agent never CRUDs — it experiences them only through the nouns below. This is the agent's mental model.

| Entity | What it is *to the agent* | Agent's relationship | Verbs |
|---|---|---|---|
| **task** | the multi-step goal; the container its work hangs on | acts on | create · get · list · complete · revoke |
| **session** | the working unit for one capsule; provisioning it yields a live capsule + a connector | acts on | create · get · list · connector · revoke |
| **handoff** | a recipient-bound window onto a session — the act of handing the live capsule to the human | acts on (repeatedly) | open · wait · get · list · cancel |
| **template** | the menu of assemblable capsules in *this* install, with their required parts and dependency status | reads | list · show |
| **skill** | procedural knowledge (markdown) the agent loads to act well | reads | list · show |
| **event / audit** | the async signal stream and the trail | reads / streams | events · audit list |
| **identity / authority** | the agent's own identity and capability scope | reads | whoami |

**Task is optional.** A single-capsule goal needs no explicit task — `session create` auto-creates an implicit single-session task; the agent names an explicit task only to thread multiple independent sessions (different recipient, trust, or failure domain).

Two things deliberately **not** entities here:

- **The connector** (CDP endpoint / filesystem path / `secret_ref`) is *surfaced* by `session create`/`session connector` as data, but it is driven with the agent's own tooling (a CDP client), **not** through `gla` verbs. The CLI is the control interface; the connector is the work channel (overview: the two agent touchpoints).
- **Completion** is not a noun the agent fetches; it is the *result* of `gla handoff wait`. The agent awaits it; it doesn't manage it.

Why these and not, say, `capability` or `route`: those are how GLA *enforces*, not how the agent *works*. Exposing them as agent verbs would push enforcement into the client — exactly the line we hold. The agent proposes (`session create`), hands off (`handoff open`), waits (`handoff wait`), and drives (connector); GLA does the minting, routing, and verifying invisibly.

---

## 3. Command reference

### Command tree

Global flags (accepted by every command):

```
-o, --output  json|ndjson|text   default: json  (text auto when stdout is a TTY)
    --fields  <a,b,c>            field mask — trims output (context economy)
-q, --quiet                      results only; suppress progress/spinners
    --no-input                   never prompt (default true when non-TTY)
    --context <name>             which GLA installation/endpoint
    --timeout <dur>              per-call deadline
    --trace-id <id>              correlate with the agent's task trace in audit
-h, --help                       add `-o json` for machine-readable usage
```

```
gla
│
├── whoami                                   read · this agent's identity + authority scope (AuthorityProfile, allowed ops)
├── schema [<noun> [<verb>]]                 read · machine-readable surface — inputs, outputs, flags, exit codes
├── version                                  read · client + connected-server version
│
├── catalog                                  read · what is installable / available in THIS install
│   └── list [--kind <k>] [--available]        --available drops entities whose dependencies are unbound
│
├── policy                                   read · what THIS install permits the agent
│   └── mounts                                 the host-mount allowed-set, denylist, default mode
│
├── template                                 read · the assemblable capsule templates (the agent's menu)
│   ├── list
│   └── show <id>                            required parts + each backing dependency's binding status
│
├── skill                                    read · procedural knowledge the agent loads
│   ├── list [--for <template>]
│   └── show <id>                            emit the SKILL.md body to stdout
│
├── task                                     act · the multi-step goal; container of sessions
│   ├── create                               open a Task + mint its task capability (parent = agent-authority)
│   │       [--intent <label>] [--recipient <ref>]
│   ├── get <id>
│   ├── list [--state <s>]
│   ├── complete <id>                        terminal; tears down sessions + capsules, revokes its capabilities
│   └── revoke <id>                          abort (non-success terminal state); same teardown
│
├── session                                  act · the working unit for one capsule; provisioning yields the connector
│   ├── create [--task <id>]                 admit an assembly, then provision a live capsule (implicit task if none)
│   │       ( -f <assembly.json>               full spec (preferred), OR the parts as flags:
│   │         --template <id> [--launcher <l>]
│   │         [--entrypoint <e>] [--connector <c>]
│   │         [--workspace <w>] [--detector <d> …] )
│   │       [--mount <host>:<target>:<ro|rw> …]  host paths the agent can reach (mode default ro)
│   │       [--ttl <dur>] [--dry-run]          --dry-run = admission only, no provisioning
│   ├── get <id>
│   ├── list [--task <id>] [--state <s>]
│   ├── connector <id>                       (re)emit the agent-connector to attach a CDP client
│   └── revoke <id>                          stop + reap this session's capsule + workspace
│
├── handoff                                  act · a recipient-bound window onto a session (the repeated act)
│   ├── open --session <id>                  mint a recipient-bound grant, mount a route, deliver the link
│   │       [--reason <text>] [--recipient <ref>] [--ttl <dur>]
│   ├── wait <id> [--timeout <dur>]          BLOCK until the human completes or the window expires
│   ├── get <id>
│   ├── list [--session <id>]
│   └── cancel <id>                          close the window early; revoke grant, unmount route
│
├── events [--task <id>] [--follow]          read/stream · NDJSON of state changes + handoff lifecycle
├── audit                                    read · the append-only trail (redacted on egress)
│   └── list --task <id>
│
└── auth                                     connection · only in profiles that authenticate the agent
    ├── login                                mTLS / token (or GLA_TOKEN via env — never on argv)
    └── logout
```

### Per-command actions

One row per leaf command. The **Group** column is blank when it carries from the row above (so the visual blocks show hierarchy). The **What the CLI does** column is the contract for that invocation — what it validates, reads, writes, and returns, plus notable non-zero exit codes. *Read* = no state change; *mutates* = changes server state (safe to retry or returns a conflict); *blocks* = a long-poll.

| Group | Command | What the CLI does on invocation |
|---|---|---|
| `self` | `gla whoami` | 1. Resolve this agent's `agent-authority` capability from the connection<br>2. Print identity, matched `AuthorityProfile`, and the allowed operation set<br>3. *Read-only* |
|  | `gla schema [<noun> [<verb>]]` | 1. Emit the machine-readable surface — every command, its args/flags with types, output schema, and exit codes<br>2. Scope to a noun/verb when given<br>3. *Read-only*; the agent introspects instead of reading docs |
|  | `gla version` | 1. Print the client version + the connected server's version/build<br>2. *Read-only* |
| `catalog` | `gla catalog list [--kind <k>] [--available]` | 1. Query the Catalog index<br>2. Filter by entity `--kind`; `--available` drops entities whose dependencies are unbound<br>3. Print entities with system-derived availability<br>4. *Read-only* |
| `policy` | `gla policy mounts` | 1. Print the host-mount policy this install applies to the agent — the allowed-set (permitted roots), the catastrophic denylist, and the default mode<br>2. *Read-only*; the agent composes mounts within this bound |
| `template` | `gla template list` | 1. List `CapsuleTemplate` entities from the Catalog index<br>2. *Read-only* |
|  | `gla template show <id>` | 1. Resolve the template<br>2. Print its required parts (entrypoint / connector / workspace / detector options) and each backing dependency's binding status<br>3. Exit 5 if unknown<br>4. *Read-only* |
| `skill` | `gla skill list [--for <template>]` | 1. List registered skills, optionally those relevant to a template<br>2. *Read-only* |
|  | `gla skill show <id>` | 1. Resolve the skill; print the SKILL.md body to stdout<br>2. Exit 5 if unknown<br>3. *Read-only* |
| `task` | `gla task create [--intent <label>] [--recipient <ref>]` | 1. Open a `Task`; mint its `task` capability (parent = `agent-authority`)<br>2. Record the intent label + recipient binding<br>3. Print `{task_id, state:active}`<br>4. *Mutates*; accepts an idempotency key so retries are safe |
|  | `gla task get <id>` | 1. Read the Task aggregate (state, sessions, counters)<br>2. Exit 5 if unknown<br>3. *Read-only* |
|  | `gla task list [--state <s>]` | 1. List tasks visible to this authority, filtered by `--state`<br>2. *Read-only* |
|  | `gla task complete <id>` | 1. Drive the Task to `completed`<br>2. Tear down its sessions + capsules; revoke descendant capabilities<br>3. Exit 7 on an invalid state transition<br>4. *Mutates* |
|  | `gla task revoke <id>` | 1. Abort the Task; same teardown as `complete` but a non-success terminal state<br>2. *Mutates* |
| `session` | `gla session create [--task <id>] ( -f <spec> \| --template <id> [parts…] ) [--mount <h>:<t>:<mode> …] [--ttl <dur>] [--dry-run]` | 1. Resolve the task: use `--task`, else auto-create (or attach to) an implicit single-session task<br>2. Assemble the spec from `-f` or the part flags; collect `--mount` entries (mode default `ro`, target default `/work/<basename>`)<br>3. Submit to Admission (mutate defaults + canonicalize mount paths → validate policy / capability / catalog / identity, and each mount vs the allowed-set + denylist + mode + the launcher's mount capability — all offline)<br>4. `--dry-run`: print accept/reject and stop (exit 3 on reject)<br>5. On accept: provision the capsule via the Worker, mounting host paths as the agent's own uid; mint the `agent-connector` capability<br>6. Print `{session_id, state, capsule, connector:{type, cdp_url\|path, secret_ref}}`<br>7. Exit 3 (policy, incl. `mount.denied`) / 4 (capability) / 5 (`mount.not_found`) / 7 (`mount.conflict`) / 8 (dependency, incl. `mount.unsupported` by the launcher)<br>8. *Mutates* |
|  | `gla session get <id>` | 1. Read the Session aggregate + state<br>2. Exit 5 if unknown<br>3. *Read-only* |
|  | `gla session list [--task <id>] [--state <s>]` | 1. List sessions, filtered<br>2. *Read-only* |
|  | `gla session connector <id>` | 1. Re-emit the agent-connector for a live session so a crashed agent re-attaches its CDP client<br>2. Prints a `secret_ref`, never a raw secret<br>3. Exit 7 if the session has no live capsule<br>4. *Read-only* |
|  | `gla session revoke <id>` | 1. Stop + reap this session's capsule and workspace; unmount routes; revoke its grants + connector<br>2. *Mutates* |
| `handoff` | `gla handoff open --session <id> [--reason <text>] [--recipient <ref>] [--ttl <dur>]` | 1. Open a window: mint a recipient-bound `grant` (short TTL, single-recipient caveat)<br>2. Program a gateway route bound to the grant<br>3. Deliver the link to the recipient via the channel<br>4. Print `{handoff_id, link, recipient, expires_at}`<br>5. *Mutates* |
|  | `gla handoff wait <id> [--timeout <dur>]` | 1. **Block** until the Completion service validates the human's done-signal, or the window expires<br>2. Print the normalized envelope `{status, result, next?}`<br>3. Exit 6 on timeout/expiry<br>4. *Read-only* long-poll |
|  | `gla handoff get <id>` | 1. Read the window's state (open / completed / expired / cancelled)<br>2. *Read-only* |
|  | `gla handoff list [--session <id>]` | 1. List windows for a session<br>2. *Read-only* |
|  | `gla handoff cancel <id>` | 1. Close the window early: revoke the grant, force-close the WebSocket, unmount the route<br>2. *Mutates* |
| `events` | `gla events [--task <id>] [--follow]` | 1. Emit events as NDJSON (state changes, handoff lifecycle)<br>2. `--follow` streams until interrupted; otherwise returns recent and exits<br>3. *Read / stream* |
| `audit` | `gla audit list --task <id>` | 1. Read the append-only audit trail for a task (redacted on egress)<br>2. *Read-only* |
| `auth` | `gla auth login` | 1. Authenticated profiles only: establish identity via mTLS or token; persist the session credential<br>2. No-op in the local profile<br>3. Secrets via env / file / stdin — never argv |
|  | `gla auth logout` | 1. Discard the persisted session credential |

> **Recipient enrollment is not on this surface.** Registering a recipient's credential — the one-time passkey enrollment (Phase E) — is an *operator* setup action: the operator issues the single-use `operator-discharge` enrollment grant out of band, and the recipient registers through the Access Gateway. The agent neither enrolls recipients nor ever sees their credentials. See `components/identity-and-auth.md`.

### Connection & auth

- **Local profile** (reference): the endpoint is a local socket (`GLA_ENDPOINT`, or a default); no token, no `login`. (Consistent with "we don't authenticate the agent in the local profile" — see `components/identity-and-auth.md`.)
- **Authenticated profiles:** `gla auth login` (mTLS / token) or a token supplied via `GLA_TOKEN` in the environment — **never** on argv.

---

## 4. Output & error shape

**Success** → stdout, a JSON object (or NDJSON lines for streams), with stable field names and prefixed IDs (`task_…`, `sess_…`, `hand_…`):

```json
{ "session_id": "sess_8fd2", "state": "issued",
  "capsule": { "id": "cap_77a1", "template": "browser-handoff" },
  "connector": { "type": "cdp", "cdp_url": "ws://127.0.0.1:premapped/...", "secret_ref": "cap_ref_..." } }
```

**Error** → stderr, a JSON object; non-zero exit:

```json
{ "error": {
    "code": "policy.denied",
    "message": "assembly requires a dependency disabled by policy: secret-intake",
    "detail": { "dependency": "vault", "ownership_mode": "disabled" },
    "skill": "interpret-gla-rejections",
    "retryable": false } }
```

The `code` is stable and namespaced (`policy.*`, `auth.*`, `catalog.*`, `state.*`, `dependency.*`, `mount.*`). The `skill` field is the agent's recovery entry point.

---

## 5. Exit-code taxonomy

Stable and documented so agents branch without parsing prose.

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected / internal error |
| 2 | usage — invalid flags or arguments |
| 3 | admission / policy rejection (assembly not allowed) |
| 4 | authentication / authorization failure (insufficient capability) |
| 5 | not found |
| 6 | timeout / window expired |
| 7 | conflict / invalid state transition |
| 8 | dependency / provider unavailable (cannot provision) |

---

## 6. Scenario 01, mapped to the CLI

The exact calls the agent makes in `scenario-01-unified` when the Bridge surface is the CLI. Phases where the agent works *inside* the capsule use the **connector (CDP), not `gla`** — marked accordingly. (`$VAR` = captured from prior JSON output.)

```bash
# Phase 1 — orient
gla whoami
gla template show browser-handoff
gla skill show browser-handoff            # load procedural knowledge

# Phase 2 — propose (validate, then provision)
# (optional — a single-capsule goal may skip this; session create auto-creates an implicit task)
TASK=$(gla task create --intent "register on acme" --recipient "$RECIPIENT" --fields task_id -q)
gla session create --task "$TASK" -f assembly.json --dry-run        # admission check only
SESS_JSON=$(gla session create --task "$TASK" -f assembly.json)     # provisions the capsule
# SESS_JSON.connector -> {cdp_url, secret_ref}  (the agent's handle to drive the browser)

# Phase 4 — drive to the form          [CONNECTOR / CDP, not gla]
#   agent uses connector.cdp_url with its own CDP client: open acme.example, go to /register

# Phase 5 — handoff #1
H1=$(gla handoff open --session "$SESS" --reason "complete registration form" --fields handoff_id -q)
#   link is delivered to the recipient via Telegram

# Phases 6-7 — user authenticates + fills the form   [no agent CLI; agent waits]
gla handoff wait "$H1" --timeout 15m
#   -> {status: submitted, next: email-verification}

# Phase 9 — inspect /verify page        [CONNECTOR / CDP, not gla]  -> "code emailed"

# Phase 11-12 — handoff #2 (same capsule)
H2=$(gla handoff open --session "$SESS" --reason "enter verification code" --fields handoff_id -q)
gla handoff wait "$H2" --timeout 15m
#   -> {status: verified}

# Phase 14 — configure the service       [CONNECTOR / CDP, not gla]

# Phase 15 — close
gla task complete "$TASK"                 # tears down capsule, revokes capabilities
```

`assembly.json` (passed to `session create -f`) — the shape defined in `04-capsule-assembly.md`:

```json
{ "apiVersion": "gla.dev/v1", "kind": "Assembly",
  "metadata": { "intent": "register on acme", "task": "T" },
  "spec": {
    "template": "browser-handoff",
    "recipient": "tg:user:123",
    "entrypoints": [ { "use": "browser-stream" } ],
    "connector":   { "use": "cdp" },
    "workspace":   { "use": "browser-profile-temp" },
    "detectors":   [ { "use": "user-done" },
                     { "use": "url-watcher", "params": { "complete_on": "/dashboard" } } ] } }
```

This scenario mounts nothing — the temp profile is ephemeral; a doc-edit flow would add a `mounts` entry (`04-capsule-assembly.md` §6). The shape of this section is exactly what's needed to relabel the sequence diagram for the CLI variant: control steps become `gla …` calls; the in-capsule work stays on the connector.

---

## 7. Open questions

- **Connector brokering.** The CLI *surfaces* the connector; whether the CDP traffic is tunnelled through the Bridge or exposed as a separate scoped worker-plane route is still open (noted in the scenario doc). It does not change the CLI surface, only what `cdp_url` points at.
- **`handoff` as a top-level noun vs `session handoff`.** Chosen as a top-level noun for a consistent noun-verb scheme and because the agent references windows by id (`hand_1`, `hand_2`); revisit if it reads awkwardly.
- **Batch operations.** Deferred — no demonstrated need for bulk task/session creation yet.
- **`schema` depth.** How much of the assembly spec's JSON Schema to expose via `gla schema session create` (enough for an agent to construct `-f` input without a skill) is a content decision.

---

## References

- Command Line Interface Guidelines — clig.dev (the human-CLI baseline).
- Speakeasy, *Making your CLI agent-friendly* — https://www.speakeasy.com/blog/engineering-agent-friendly-cli
- *Rewrite Your CLI for Agents (Or Get Replaced)* — https://dev.to/meimakes/rewrite-your-cli-for-agents-or-get-replaced-2a2h
- *Writing CLI Tools That AI Agents Actually Want to Use* — https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no
- *You Need to Rewrite Your CLI for AI Agents* (Google Workspace CLI, agents-first) — bensbites.
- Algolia, *We rewrote the Algolia CLI for AI agents*; GitLab `glab` issue #8177, *Enhance CLI agent-friendliness*.
- 12 Factor CLI Apps (Heroku).
