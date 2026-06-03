# GLA — Slice 1: Inbound + Orient (scenario-01 Phases 0–1)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks GLA-014 (inbound/connect) and GLA-016
> (orient).** **Scope:** the inbound seam and the orientation read-surface for scenario-01 Phases 0–1 — the
> first observable behaviour (a recipient-bound inbound message reaching the agent, the agent connected with
> a scoped authority) and the agent's discovery of what this install can assemble.
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it is *concretizing* a baseline-§1 layout slot, never
> overriding a goal, vocabulary, or invariant.
>
> **Reads against:** `docs/architecture/kernel-contracts.md` §1/§2/§5/§6/§7, `docs/architecture/baseline.md`
> §1/§2/§5/§6/§8, `docs/components/{agent-bridge,channel-adapter,catalog,identity-and-auth,capability-service}.md`,
> `docs/05-cli-and-entities.md` §2–§5, `docs/02-provider-and-extension-model.md` §3–§5.

## Rule-3 note

`bmad-dev-story` / `bmad-quick-dev` (the BMAD build skills) **were loaded** but cannot run unattended for
these tasks: `bmad-dev-story` SKILL.md Step 1 (`tag="sprint-status"`) reads
`{implementation_artifacts}/sprint-status.yaml` to find the next ready story and then opens a **context-filled
per-story spec file**; neither a `sprint-status.yaml` nor a per-story spec file exists in this repo (only BMAD
templates), so the workflow hits its interactive `<ask>Choose option [1]/[2]/[3]/[4]</ask>` HALT. Per
`AGENTS.md` Rule-3's explicit allowance, that path was stopped, the blocker named, and this slice was driven
**from the committed design set** as the stated fallback — the same posture the Phase-1/2/3 artifacts
(`kernel-contracts.md`, `baseline.md`, `test-strategy.md`) already record. The skills actually run per task are
recorded in this slice's build note (below) and the task `--notes`.

---

## 1 · The inbound seam (GLA-014 #1/#3/#7)

Inbound is **a port the core depends on, never a provider-specific call** (`kernel-contracts.md §6` ·
`ChannelPort`; `components/channel-adapter.md`). The shape is fixed in the kernel:

```ts
interface ChannelPort {
  deliver(recipient: RecipientRef, link: string, delegation: OpaqueToken): Promise<void>;
  receive(): AsyncIterable<{ recipient: RecipientRef; message: string; chatContext: unknown }>;
}
```

- **Delivery to the agent, with the recipient binding attached (GLA-014 #1, GLA-015 #1).** An inbound message
  carries a channel-specific `recipientRef` (`tg:user:123`, `cli:user:1`). The adapter does **not** invent a
  user; it asks `IdentityPort.bind(recipientRef, {channel})` (`kernel-contracts.md §7`) which maps the ref to a
  stable `UserIdentity` and returns a `RecipientBinding` — **narrow-only, never widened** (`identity-and-auth.md`
  invariant). The agent receives `{ text, recipientRef, binding }`: the message *and the recipient it is bound
  to*. Binding is the only identity fact at Phase 0 (`authStrength: "none"` until Phase-E enrollment, out of
  this slice — Slice 4).
- **No state change (GLA-015 #3).** `receive()` and `bind()` touch **no Task and no Session** — there is no task
  or session yet at Phase 0. Binding is a pure lookup/derive over the identity map; it writes nothing to the
  task/session aggregates. (Observed by asserting the task/session stores are byte-identical before/after.)
- **A second channel is a provider, with no seam change (GLA-014 #7, GLA-015 #4).** Because the core depends on
  `ChannelPort` (the *shape*), a Telegram adapter is added exactly as `channel-cli` is — a new
  `adapters/channel-<name>/` implementing the same port, injected at `app` (`baseline.md §6`). The core imports
  no channel; the import-boundary lint *proves* it (a core/bridge import of `@gla/channel-cli` fails the gate).
  The full-capability seam includes outbound `deliver` (channel-delegation-gated) so a richer channel (Telegram
  Mini App button vs. a plain link) is a render choice *inside* the adapter, never a core branch.

`channel-cli` is the **real fallback channel** (`docs/03 §2`, "local CLI"): `receive()` yields inbound items
from an injectable source (an in-memory queue for tests, a file, or stdin), each run through identity binding;
`deliver()` writes the link to stdout / a file the E2E "human" polls. It is in-tree, remote-external ownership
— a traditional dependency, **no `wpm` package** (GLA-014 #6; the only inbound dependency is the channel client
itself, named for in-tree integration).

## 2 · The agent-authority anchor + non-forgeable issuance (GLA-014 #2/#3, GLA-015 #2)

On connect, the Agent Bridge performs **trigger → admit → anchor** (`components/agent-bridge.md`); it *holds no
cognition and mints nothing itself* — it asks the Capability service.

- **The anchor.** `agent-authority` is the root capability (`kernel-contracts.md §2.1`): parent = none, defining
  caveats `authority-profile` and **`allowed-ops`**. In the **local single-operator profile** (`baseline.md §5`)
  the agent is *not* authenticated (replaced by verified Bridge network isolation — a doctor probe, deferred);
  the Bridge still anchors the authority, minting it for the local agent from a local `AuthorityProfile` that
  declares the operation set. On connect the agent gets back the anchor **and the set of operations it allows**
  (the `allowed-ops` caveat), which is exactly what `whoami` later reads.
- **Non-forgeable issuance (GLA-014 #3, the load-bearing negative).** The anchor is an `OpaqueToken` minted by
  `CapabilityPort.mint` (the reference `HmacCapabilitySigner`, `kernel-contracts.md §2.4`). Its authority is the
  **signed** caveat chain — `whoami` resolves identity/ops **only via `verify()`**, never by trusting unsigned
  token fields. A tampered or forged token fails the HMAC chain check and `verify()` returns
  `{ok:false, reason:"auth.malformed"}` → the read is rejected. The agent receives a **reference/token, never
  raw signing material** (`capability-service.md` invariant). This is the single primitive everywhere
  (`baseline.md §4`): later `task`/`session`/`grant` capabilities all attenuate from this anchor, child ⊆ parent.

## 3 · The orient read-surface (GLA-016 #1/#2/#6, GLA-017)

Orientation is **the single interface the agent reads through** — the Agent Bridge read-models
(`components/agent-bridge.md`; `docs/05 §2`), all **side-effect-free** (GLA-017 #4). Read contract:

| Read op | Returns (stable shape) | Backed by | Unknown id |
|---|---|---|---|
| `whoami` | `{ identity, authority_profile, allowed_ops }` (JSON) | capability `verify()` over the anchor | — |
| `template show <id>` | required parts + **each backing dependency's binding status** | `CatalogPort.resolveTemplate` | not-found → **exit 5** |
| `template list` / `catalog list` | entities **available in this install**, `available` **system-derived** | `CatalogPort.list({kind?, available?})` | — |
| `skill list` / `skill show <id>` | skill manifest / the SKILL.md body | `CatalogPort` skill index | unknown → exit 5 |

- **System-derived availability (GLA-016 #2, GLA-017 #3).** The Catalog is **Store → Ingester → Index**
  (`docs/02 §4` · `components/catalog.md`): ingest = **mutate**(defaults) → **validate**(family schema +
  `config_schema` is itself valid JSON Schema, via the kernel validator) → **index** with availability computed
  from a **probe seam** (`probe()` → `available | degraded | unavailable`) and each part's `DependencyBinding`
  status — **never author-declared** (the frozen invariant). `catalog list` (no `--available`) returns only
  what indexed as available *plus* nothing the caller asserted; flipping a probe to `unavailable` drops the
  entity from the available view. This is the property under test, not a public probe API (`baseline.md §6`).
- **New template / skill source = no seam change (GLA-016 #6).** Templates and skills are catalog entities read
  through `CatalogPort`; a new source (another manifest directory, a plugin package) is ingested by the same
  pipeline and appears everywhere registry-driven (`docs/02 §5`) with zero core change. The seam is the port,
  not the manifest location.
- **The agent learns the holes without guessing (GLA-016 #3, operating experience).** `template show
  browser-handoff` enumerates the **required parts** (launcher / entrypoint / connector / workspace / detector)
  and, per part, the **binding status** of the dependency that backs it. An unbound or `unavailable` dependency
  is *visible as a hole* — the agent does not guess what is installed; it reads the gap and (later) composes
  only against `available` parts (allowlist-by-construction, `docs/02 §3.1`). No dependency is classified as
  non-traditional for orientation (GLA-016 #5): the read surface is pure in-tree code over the kernel.

## 4 · Operating experience (GLA-014 #4, GLA-016 #3)

Agents-first, JSON by default, text only at a TTY, **no interactive prompts** (`docs/05 §1`; `baseline.md §8`).
Scenario-01 Phases 0–1 in one breath:

```
[channel-cli receive] → agent gets { text, recipientRef, binding }      # Phase 0 (inbound)
gla whoami                                                              # identity + allowed_ops (JSON)
gla template show browser-handoff                                       # required parts + binding status
gla skill show browser-handoff                                         # load procedural knowledge
gla catalog list [--kind … --available]                               # only available, system-derived
```

The agent **discovers it is connected** by reading `whoami` (a resolvable anchor ⇒ connected; its `allowed_ops`
is what it may do). Every orient command exits `0` on success, **exit 5** on an unknown id, exit 2 on usage —
the exit code is the coarse branch, the JSON `error.code` the precise fact (`kernel-contracts.md §5`).

## 5 · Build & observation plan (GLA-014 #5, GLA-016 #4)

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green (`tsc -b && biome ci . &&
vitest run`, `CONTRIBUTING.md`).

| # | Package | What it adds | Observed by (test, per `test-strategy.md`) |
|---|---|---|---|
| 1 | `packages/capability` | `CapabilityService` over the kernel signer: `mintAgentAuthority(profile)` (carries `allowed-ops`), `whoami(token)` (resolve via `verify()`), `revoke`; holds the revocation snapshot | UNIT: `whoami` JSON shape; **a forged/tampered anchor is rejected** (GLA-014 #3) |
| 2 | `packages/catalog` | Store→Ingester→Index; in-tree `browser-handoff` template + its provider manifests + a skill; `probe()` availability seam; `list/show/templateShow/skillList/skillShow` | UNIT: availability is system-derived (flip probe → drops); `templateShow` lists parts + binding status; unknown id → not-found |
| 3 | `packages/identity` | `RecipientBinding`: `bindFromInbound(channelRef)` maps a channel ref → stable `UserIdentity` (no enrollment) | UNIT: binding maps/narrows; deterministic per ref |
| 4 | `adapters/channel-cli` | `ChannelPort`: `receive()` yields `{ text, recipientRef }` from queue/file/stdin with binding attached; `deliver()` writes the link | CONTRACT: receive attaches the binding; a 2nd channel fits the port |
| 5 | `packages/bridge` | read surface + `connect()` → issues the anchor; `whoami / templateList/Show / skillList/Show / catalogList` delegating to capability+catalog; thin transport (enforces nothing) | INTEGRATION: connect anchors; reads are pure (no task/session writes — GLA-015 #3, GLA-017 #4) |
| 6 | `surfaces/cli` | wire `gla whoami / template list / template show <id> / skill list / skill show <id> / catalog list [--kind --available]`; JSON to stdout, exit 0 / **5 on unknown id** / 2 on usage | INTEGRATION: exit-code map; `whoami` JSON; `template show unknown` → exit 5; import-boundary holds |

**End-to-end observation of orientation (GLA-016 #4):** a single test drives `connect()` then each read op
against a seeded in-tree catalog and asserts (a) `whoami` returns identity + allowed_ops as JSON, (b)
`template show browser-handoff` returns required parts each with a binding status and `template show <unknown>`
exits 5, (c) `catalog list` returns only system-derived-available entities and a flipped probe removes one, and
(d) the task/session stores are unchanged across all of it. **Observation of inbound (GLA-014 #5):** inject a
message into `channel-cli`'s queue, assert `receive()` yields it with the recipient binding attached, and
assert no task/session state moved — the "delivered, recipient-bound, connected" state is exactly those three
facts together.

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above); this slice
was implemented directly from the design set. The architect/test-design steering for the inbound seam, the
agent-authority anchor, and the orient read-contract is this document, grounded in the cited committed docs.

## Cross-references

- `docs/architecture/kernel-contracts.md` — §1 entities, §2 capability/anchor + non-forgeable issuance, §5
  error/exit, §6 `ChannelPort`/`CatalogPort`/`IdentityPort`/`CapabilityPort`, §7 identity/binding.
- `docs/architecture/baseline.md` — §1 package layout + boundary rules, §2 cognition-vs-enforcement, §5 local
  profile (agent auth deferred), §6 horizontal extension (2nd channel / new source), §8 `gla` ergonomics.
- `docs/components/{agent-bridge,channel-adapter,catalog,identity-and-auth,capability-service}.md` — the seam
  responsibilities this slice implements.
- `docs/05-cli-and-entities.md` — §2 the agent's nouns, §3 `whoami`/`template`/`skill`/`catalog` commands, §4
  output shape, §5 exit codes.
- `docs/02-provider-and-extension-model.md` — §3 manifest contract + `config_schema`, §4 ingest pipeline +
  system-derived availability, §5 registry-driven reads.
- `docs/architecture/test-strategy.md` — §1 test levels, §2 the scenario-01 harness (Phases 0–1).
