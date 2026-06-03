# GLA — Slice 2: Propose + Admit (scenario-01 Phase 2)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks GLA-018 (propose) and GLA-020
> (admit).** **Scope:** the propose→admit thread for scenario-01 Phase 2 — opening a Task (the
> revocation/budget/audit root) and minting its `task` capability, resolving a thin proposal into a
> validated `ResolvedAssemblySpec`, and the Kubernetes-style **mutate → validate** admission pipeline
> (the enforcement heart, `baseline.md §2`) that accepts (→ dispatch a Session in `issued`, no spawn)
> or rejects with a stable namespaced code → documented exit code.
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and
> are not restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot,
> never overriding a goal, vocabulary, or invariant.
>
> **Reads against:** `kernel-contracts.md` §2 (capability/attenuation), §3 (AssemblySpec), §4
> (config_schema), §5 (error/exit), §6 (`PolicyPort`/`CatalogPort`); `baseline.md` §2 (cognition vs
> enforcement), §5 (local profile: minimal MVP policy, permissive mounts + denylist); `docs/04` (the
> AssemblySpec, the mutate→validate resolution §4, the mount model §6); `components/{admission-and-
> policy,task-service,session-service,capability-service,catalog}.md`; `docs/03 §11` (Cedar embedded);
> `docs/05 §3/§5/§6` (the `task`/`session` commands, exit codes, scenario calls); `test-strategy.md`
> (S-7 offline-reject exit codes; levels).

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** but cannot run unattended for these tasks.
`bmad-dev-story` SKILL.md Step 1 (`tag="sprint-status"`) reads
`{implementation_artifacts}/sprint-status.yaml` to find the next ready story and then opens a
context-filled per-story spec file; in this repo
`_bmad-output/implementation-artifacts/sprint-status.yaml` and any per-story spec file **do not
exist** (the directory holds no stories), so the workflow hits its interactive
`<ask>Choose option [1]/[2]/[3]/[4]</ask>` HALT and cannot continue. Per `AGENTS.md` Rule-3's explicit
allowance, that path was stopped, the blocker named, and this slice was implemented **directly from
the committed design set** as the stated fallback — the same posture the Slice-1 and Phase-1/2/3
artifacts already record. The skills actually run per task are recorded in the build note (below) and
each task's `--notes`.

---

## 1 · Propose (GLA-018/019) — the Task root + the `task` capability

Propose opens the durable spine of the goal and authors the thin proposal; it mints/runs nothing
beyond the capability the task needs.

- **Task as the revocation/budget/audit root (`task-service.md`).** `TaskService.create({intent?,
  recipient?}, agentAuthorityToken)` opens a `Task` in `active` (the kernel Task lifecycle's initial
  state) and records the opaque `intentLabel` (agent cognition, never parsed) and the bound
  `recipient` (narrow-only, never invented). `get`/`list` read the aggregate. A **single-capsule goal
  needs no explicit task**: `session create` without `--task` opens a real `Task` flagged `implicit`
  via `createImplicit(...)` — a real object with an id, so audit and resume still work
  (`task-service.md` "optional & implicit"). **The implicit task is opened only on a real-run accept**
  (after admission succeeds), never before admission and never on a dry-run/reject — so a rejected or
  dry-run `session create` leaks **no orphan task or capability**. The agent names an explicit task
  only to thread several independent sessions; **multi-session / other-intent threading is the same
  call with no seam change.**

- **The `task` capability is minted by ATTENUATING the agent-authority (parent = agent-authority,
  child ⊆ parent, narrower scope).** `create` calls `CapabilityPort.attenuate(agentAuthorityToken,
  [...])`, adding only narrowing caveats: a `scope` caveat `"/task/<id>"` (a **new** dimension the
  agent-authority did not constrain, so it only narrows further — the task cap is bound to its own
  task path) and a task-scoped `allowed-ops` **subset** of the agent's ops. The kernel's
  `attenuate` is **reject-or-narrow** on the ⊆-parent rule (`kernel-contracts.md §2.2`, invariant 3),
  so a mis-built attenuation throws `auth.attenuation_widened` rather than minting a broader child —
  the load-bearing negative. `Task.taskCapabilityRef` records the minted capability id.

- **Bridge proposal submission + the returned id.** The Agent Bridge (`agent-bridge.md`) is a thin
  transport: `taskCreate` connects (anchors the agent-authority) then delegates to the Task service,
  returning `{task_id, state:"active", …}`; `sessionCreate` submits the proposal to admission and
  returns the dispatched session id (or, on `--dry-run`, the accept/reject). The Bridge **enforces
  nothing itself** — admission/policy/capability are server-side (`docs/05 §1`).

- **Compose-from-template + learn-malformed-before-provision.** The proposal is a thin delta over a
  template (`{template, recipient, overrides…}`). `packages/assembly`'s **resolver** performs the
  *mutate* half: deep-merge the template's structural defaults (launcher / entrypoint / connector /
  workspace / detectors / ttl) **under** the agent's overrides (the agent wins only on open fields;
  the resolver fills the holes), then **canonicalize mount host paths** (absolute, `..`/`.` collapsed,
  `kernel-contracts.md §3.1`). It reuses the kernel's structural validator (`validateAssembly`), so a
  **proposal that does not conform to the assembly contract is rejected at submission with a typed
  error BEFORE admission** (GLA-019 AC#4) — the agent treats authoring like a type-checker (generate →
  validate → fix), learning malformed shapes before anything is provisioned.

## 2 · Admit (GLA-020/021) — the mutate → validate pipeline (the heart)

`AdmissionService.admit(proposal, presentedCapability, {dryRun})` is the **only path from "the agent
proposed a session" to "the system will build one"** (`admission-and-policy.md`). It MINTS NOTHING and
RUNS NOTHING.

- **MUTATE.** Reject an unknown template (`catalog.unknown` → exit 5) before anything. Then enforce the
  **fixed/open line** (docs/04 §4/§5): an agent override of a **template-FIXED** part — the launcher
  (isolation tier / native base) and the workspace for browser-handoff — is a **REJECT, not a silent
  override** (`policy.denied` → exit 3); an override of an **OPEN** part (entrypoint / connector /
  detector) must use a provider in the template's `compatibleWith` set (`relations.compatibleWith`),
  else reject. (Decided from the agent's *explicit* proposal parts, before the resolver merges defaults
  in.) Then inject the template defaults via the assembly resolver and canonicalize mounts. Mutation
  **fills defaults but never invents missing required semantics** — a missing required detail (e.g.
  `url-watcher`'s required `complete_on`) is a **REJECT, not a guess** (GLA-021 AC#3), surfaced by the
  per-part config-schema check naming the offending field.

  **Mount canonicalization resolves symlinks.** Each mount host path is lexically normalized
  (`..`/`.` collapsed) AND **symlink-resolved** via a best-effort `fs.realpathSync` *before* the
  allowed-set/denylist check, so a symlink inside the allowed-set that points at a denied path (e.g.
  `~/.ssh`) cannot slip past — the check runs on the **real target**. A path that does not exist yet
  falls back to the lexical form (existence is OS-enforced at spawn). This is the one **scoped
  exception to pure-offline**: the resolver reads the filesystem ONLY to realpath a declared mount host
  path; a proposal with no `mounts` never touches the FS, so non-mount dry-runs stay fully offline.

- **VALIDATE — OFFLINE (modulo the scoped mount-realpath above), an ordered list of pure predicates:**
  1. **Cedar policy** (`PolicyPort`, **forbid-wins**) → `policy.*` → exit 3.
  2. **Capability scope** — every `scope` caveat on the presented capability must contain the session
     path the proposal would occupy (`/task/<task>`). Decided **from the capability + the request
     alone — no lookup** (the contract). Outside scope → `auth.insufficient` → exit 4.
  3. **Catalog availability** — every `use`d provider registered + available, else
     `catalog.unknown` (→ 5) / `catalog.unavailable` (→ 8). **Availability-as-contract:** it is
     SYSTEM-DERIVED by the catalog (a flipped probe drops the entity), never author-declared.
  4. **Recipient / identity** — the bound recipient is a valid binding (the identity-strength check is
     a **stub** this slice; full enrollment/verify is Slice 4).
  5. **config_schema per part** — kernel `validateConfig`; off-schema input → `policy.denied` → 3.
  6. **Per-mount** — operator allowed-set + **catastrophic denylist** + mode + the **RESOLVED
     (template-fixed) launcher's** declared mount capability → the `mount.*` codes (`denied→3`,
     `not_found→5`, `conflict→7`, `unsupported→8`). Under the permissive MVP allowed-set (`/`) the
     **denylist is the only guard**, so it covers the docs/04 §6 / baseline §5 full set: the Docker
     socket, **`~/.ssh`** (resolved to `$HOME/.ssh`), and the **GLA state dir** (capability signing
     material / session state; `$GLA_STATE_DIR` or `$HOME/.gla`) — each denying itself and everything
     beneath it. The mount-capability gate reads the **fixed** launcher (the fixed-part check already
     rejected any agent-chosen launcher), never an agent-supplied one. Structural shape +
     duplicate-target conflicts are caught by the resolver's `validateAssembly`; this is the **policy**
     layer. The agent's *actual* file access is OS-enforced at spawn as the agent's uid (the
     confused-deputy bound), not here.

- **Task dispatch + stable reject codes.** On **accept**, the result carries the immutable
  `ResolvedAssemblySpec`; on a **real run** the Bridge dispatches it — `SessionService.createFromAdmitted`
  creates the Session under the task in `issued` (`proposed → issued`), pinning a deep-**frozen** spec
  (immutable after admission, invariant 9) and attaching it to the task's chain. **It does NOT spawn
  the capsule — provisioning (mint grant → mount route → spawn) is Slice 3, left as a clear
  `SessionService.provision()` seam.** On **reject**, a stable namespaced `code` → documented exit
  code, surfaced as `{code, message, detail, skill, retryable}` (`docs/05 §4`).

- **Dry-run == real run.** `--dry-run` runs the **exact same** mutate+validate and returns the **same
  accept/reject**; the pipeline never provisions, so only the *caller* withholds dispatch on a dry-run
  accept (GLA-021 AC#4). **Adding a new check or policy changes no admission caller or the pipeline
  contract** (AC#5/#8): the validate stage is an ordered list of pure predicates, and `admit`'s arity
  / `AdmitResult` shape are fixed.

## 3 · Cedar (GLA-006) — the PolicyPort, forbid-wins, fail-closed

`adapters/policy-cedar` implements the kernel **`PolicyPort`** using the **real Cedar engine** via
`@cedar-policy/cedar-wasm/nodejs` (an in-tree library, `docs/03 §11` "GLA core, integrated in-tree
behind the policy port"). Cedar is forbid-wins by construction; the adapter additionally treats **every
non-`allow` outcome** — a `deny`, an evaluation failure, a policy/entity parse error, or any throw — as
`forbid`. It **fails CLOSED at load**: a malformed policy set throws `CedarPolicyLoadError` (or, with
`throwOnLoadError:false`, arms permanent deny-all), so an authoring/load error can **never** produce a
`permit`. **Core/admission call the port WITHOUT referencing Cedar** (AC#1): they depend on the
`PolicyPort` *shape*; `app` injects `CedarPolicyAdapter` (the import-boundary lint proves no
core/admission package imports `@gla/policy-cedar`). Swapping the engine — a different Cedar build, or
a hand-rolled forbid-wins PARC evaluator — is an internal port substitution that **changes no core
code** (AC#5): the only published surface is `CedarPolicyAdapter implements PolicyPort` + a policy-set
string. The **minimal MVP policy set** ships the local-profile base (permit `admit`) plus a
`denied-template` deny example (for the forbid-wins test) and a catastrophic-rw seatbelt.

> **Cedar choice.** The **real Cedar WASM engine** was used (preferred path) — it loads and authorizes
> in this Node environment (verified: `getCedarVersion() → 4.11.0`, forbid-wins confirmed). The
> in-tree forbid-wins PARC fallback was therefore not needed.

## 4 · Build & observation plan

Built bottom-up behind the kernel ports; the whole repo stays `pnpm gate`-green (`tsc -b && biome
ci . && vitest run`, `CONTRIBUTING.md`). New/changed packages and their observation:

| # | Package | What it adds | Observed by (test) |
|---|---|---|---|
| 1 | `adapters/policy-cedar` | `CedarPolicyAdapter` (real Cedar) + `MVP_POLICY_SET` | CONTRACT: pure/total/order-independent/deterministic/**forbid-wins**/**fail-closed** |
| 2 | `packages/task` | `TaskService`: create (attenuate task cap), implicit, get/list, lifecycle | UNIT: task cap ⊆ agent-authority (kernel predicate); implicit task; malformed-anchor reject |
| 3 | `packages/assembly` | resolver: mutate (defaults + mount canonicalization, incl. **symlink realpath**) → `ResolvedAssemblySpec` | UNIT: defaults injected; mount canonicalize + **symlink→real-target**; **malformed proposal rejected at submission** |
| 4 | `packages/admission` | `AdmissionService` mutate→validate; **fixed/open + compatibility**; **denylist (`~/.ssh` + state dir)**; the `PolicyPort` + catalog/identity ports it owns | UNIT: each rejection class → its code + exit (3/4/5/7/8); **fixed-part/incompatible → reject**; **`~/.ssh`/state-dir/symlink-escape → mount.denied**; **dry-run == real run**; missing-required → reject |
| 5 | `packages/session` | `SessionService.createFromAdmitted` (issued, no spawn); `provision()` seam | UNIT: created in `issued`; **spec immutable (frozen)**; `provision()` rejects (Slice-3 seam) |
| 6 | `packages/bridge` | `taskCreate/Get/List`, `sessionCreate` (admit → dry-run or dispatch), `sessionGet/List` | INTEGRATION: routes ops; never imports policy-cedar |
| 7 | `surfaces/cli` | `gla task create/get/list`; `gla session create (-f \| --template …) [--mount] [--dry-run]` | INTEGRATION: exit-code map; dry-run accept/reject; `-f`/flag compose |
| 8 | `packages/app` | `createBridge()` — inject **real Cedar** + catalog→admission adapter into the bridge | INTEGRATION: real-Cedar accept + `policy.denied` → exit 3 through the CLI |

**End-to-end observation of propose+admit:** drive `gla task create`, then `gla session create
--dry-run` (accept) and a deliberate reject per class, asserting the JSON shape + exit code; then a
real run dispatches a Session in `issued` (no connector — that is Slice 3). The capability-scope,
forbid-wins, determinism, fail-closed, and dry-run==real-run invariants are asserted at the unit/
contract level (the security seam), and the real-Cedar thread end-to-end at the app/CLI level.

## 5 · Dependencies

- **`@cedar-policy/cedar-wasm` (`adapters/policy-cedar` only).** The real Cedar engine, behind the
  `PolicyPort`. In-tree library (no host install); `docs/03 §11` classifies the policy engine as GLA
  core integrated in-tree behind the port. **No other package depends on it** (only `app` imports the
  adapter that wraps it). No `wpm` package.
- Everything else is workspace-internal (`@gla/kernel`, `@gla/assembly`, `@gla/catalog`, …); no new
  third-party host-touching dependency. `packages/assembly` uses Node's built-in `node:path` (posix
  normalize) and `node:fs` (`realpathSync`) for mount canonicalization — the **only** filesystem touch
  in the slice, scoped to resolving a declared mount host path's symlinks before the allowed-set/
  denylist check (non-mount dry-runs stay offline). `packages/admission` uses `node:os`/`node:path` to
  resolve the default denylist (`$HOME/.ssh`, the GLA state dir) to absolute paths.

## Deferred (Slice 3+)

Provisioning (spawn: mint grant → mount route → spawn the capsule via the Worker, return the
`agent-connector`) is **Slice 3** — `SessionService.provision()` is the explicit seam. Full
recipient enrollment/verify is **Slice 4** (admission's identity check is a stub here). Handoff
windows, completion, and teardown are later slices.

## Detector vocabulary — reconciled (`url-watcher`)

The committed examples in `docs/04 §1`/`docs/05 §6` (and the `GLA-066` scenario calls) use
**`url-watcher`** as the detector `use` name. The catalog now **registers the URL-completion detector
provider under that capability name** (`metadata.name: "url-watcher"`), and the browser-handoff
template's default detector role points at `url-watcher`. The in-tree adapter package stays
`@gla/detector-url` (the package name is internal; the agent composes against the catalog's capability
name). So `gla session create -f` with `{ "use": "url-watcher" }` resolves, and the scenario-01
capstone runs the docs' calls unedited. (`user-done` is unchanged.)

## Build note — BMAD skills actually run

Per Rule-3, recorded for the evidence trail: the BMAD build skills could not run unattended (above);
this slice was implemented directly from the design set. The architect/test-design steering for the
propose seam, the `task`-capability attenuation, the mutate→validate pipeline, and the Cedar PolicyPort
is this document, grounded in the cited committed docs.

## Cross-references

- `kernel-contracts.md` — §2 capability/attenuation (the task cap ⊆ agent-authority), §3 AssemblySpec
  + Mount + Resolved, §4 config_schema, §5 error/exit (the mount map), §6 `PolicyPort`/`CatalogPort`.
- `baseline.md` — §1 layout + boundary rules (admission/task depend on the port, app injects Cedar),
  §2 cognition-vs-enforcement (admission is the enforcement heart), §5 local profile (minimal policy,
  permissive mounts + denylist).
- `docs/04` — the AssemblySpec, the five-move authoring flow, mutate→validate resolution §4, the mount
  model §6. `docs/03 §11` — Cedar embedded behind the policy port.
- `components/{admission-and-policy,task-service,session-service,capability-service,catalog}.md` — the
  seam responsibilities this slice implements.
- `docs/05` — §3 the `task`/`session create` commands, §5 exit codes, §6 the scenario-01 calls.
- `test-strategy.md` — §1 levels, §3 S-7 (offline-reject exit codes), the package-to-level map.
