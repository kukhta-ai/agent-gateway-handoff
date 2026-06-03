# Development SDLC — sequence

The autonomous, BMAD-based development process for this repo, as a sequence diagram. This is the
**authoritative, complete picture** of the flow `AGENTS.md` encodes; read them together. Text/Mermaid so it
lives in version control and an agent can parse it directly (no HTML/browser needed).

Personas are persistent BMAD subagents — **spawned once, resumed** for each later call in their lifetime
(`SPAWN` vs `RESUME` below). Development is **sequential**: one worker active at a time, a single working
tree, story sub-branches via `checkout -b` (not worktrees). `[GATE]` marks a human approval point — stop
and wait. Git operations are called out on the `git` lifeline.

> This is the full greenfield pipeline: the planning personas build the design set from the product idea. In
> a project that **already has a committed design set**, Phases 1–3 become conformance reviews — the planning
> personas run the same workflows but *steered from the committed docs* (see `AGENTS.md` → "How the design
> set maps onto BMAD") rather than designing from scratch. The branch names (`feature/<epic>`,
> `feature/<epic>-task-<id>`) and gates are identical either way.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant M as Main
    participant AN as analyst
    participant PM as pm
    participant UX as ux-designer
    participant AR as architect
    participant T as tea
    participant SM as sm
    participant W as worker (dev)
    participant R as retro
    participant I as investigator
    participant S as System
    participant G as git

    Note over U,G: Phase 1 — Analysis (branch: dev)
    U->>M: product idea
    M->>AN: SPAWN product-brief
    AN-->>M: product-brief.md
    M->>G: commit product-brief on dev
    U-->>M: [GATE] approve brief

    Note over U,G: Phase 2 — Planning (branch: dev)
    M->>PM: SPAWN prd
    PM-->>M: prd.md
    M->>UX: SPAWN ux-design (optional, if there is a UI)
    UX-->>M: ux-spec.md
    M->>G: commit prd + ux-spec on dev
    U-->>M: [GATE] approve PRD

    Note over U,G: Phase 3 — Solutioning + Test Architecture (branch: feature/<epic>)
    M->>G: checkout -b feature/<epic> from dev
    M->>AR: SPAWN create-architecture
    AR-->>M: architecture.md (decisions)
    M->>AR: RESUME create-epics-and-stories
    AR-->>M: epic files + draft stories (seed the backlog)
    M->>T: SPAWN testarch-test-design (system)
    T-->>M: test-design (arch + qa)
    M->>T: RESUME testarch-framework
    T-->>M: tests/ scaffold
    M->>T: RESUME testarch-ci
    T-->>M: CI workflow (wires the project quality gate)
    M->>AR: RESUME check-implementation-readiness
    AR-->>M: readiness PASS
    M->>G: commit arch + epics + test-arch + ci
    U-->>M: [GATE] approve solutioning

    Note over U,G: Phase 4 — Sprint setup (branch: feature/<epic>)
    M->>SM: SPAWN sprint-planning
    SM-->>M: sprint-status.yaml
    M->>T: RESUME testarch-test-design (this epic)
    T-->>M: test-design-<epic>
    M->>SM: RESUME create-story (per task)
    SM-->>M: story files (one per backlog task)
    M->>G: commit stories + sprint-status
    U-->>M: [GATE] mark stories ready

    Note over U,G: Phase 5 — Autonomous build (sequential, single working tree)
    M->>S: install + configure automator

    Note over M,W: Story N (one backlog task) — repeat per task
    M->>G: checkout -b feature/<epic>-task-<id>
    M->>W: SPAWN create-story (worker)
    W-->>M: story file confirmed
    M->>W: RESUME dev-story
    W-->>M: code + tests
    M->>W: RESUME qa-generate-e2e-tests
    W-->>M: E2E tests added
    M->>W: RESUME story-automator-review (cycle 1)
    W-->>M: findings or clean

    loop until clean (≈ up to 5 cycles)
        M->>W: RESUME dev-story (apply review findings)
        W-->>M: follow-ups done
        M->>W: RESUME story-automator-review (cycle n)
        W-->>M: findings or clean
    end

    Note over W: task verified against acceptance criteria; status = Done
    W->>G: commit feat + test + fix (task-<id>)
    M->>G: checkout feature/<epic>; merge --no-ff task-<id>
    M->>G: branch -d feature/<epic>-task-<id>

    Note over M,R: after the epic's tasks are Done
    M->>R: SPAWN retrospective
    R-->>M: retrospective-<epic>
    M->>G: commit retrospective on feature/<epic>

    Note over U,G: Phase 6 — Epic gate (branch: feature/<epic>; fix sub-branch if needed)
    M->>T: RESUME testarch-trace (initial coverage + interim gate)
    T-->>M: coverage matrix
    M->>T: RESUME testarch-nfr
    T-->>M: NFR report
    M->>S: clean-environment reset + run full suite (cold start)
    S-->>M: failures (if any)
    M->>I: SPAWN investigate + systematic-debugging
    I-->>M: root cause + fix plan
    M->>G: checkout -b fix/<epic>/<issue>
    M->>W: re-SPAWN dev-story (apply fix)
    W-->>M: patched code
    W->>G: commit fix (fix/<epic>/<issue>)
    M->>G: checkout feature/<epic>; merge --no-ff fix; branch -d fix
    M->>S: re-run cold-start suite
    S-->>M: green
    M->>T: RESUME testarch-trace (rerun after fix → final gate)
    T-->>M: PASS / CONCERNS / FAIL / WAIVED
    U-->>M: [GATE] dispose CONCERNS

    Note over U,G: Phase 7 — Handoff (branch: feature/<epic> → dev → main)
    M->>G: push origin feature/<epic>
    M->>S: gh pr create --base dev
    S-->>M: PR opened
    U-->>M: [GATE] review PR + merge → dev (promotion to main is a separate human decision)
```

## Legend

- **SPAWN** — start a persistent subagent for a role (first call in its lifetime).
- **RESUME** — re-enter an already-spawned subagent, preserving its context.
- **[GATE]** — a human approval point; the agent stops and waits.
- **solid arrow** — a call; **dashed arrow** — its return.
- Branch topology: `main → dev → feature/<epic> → feature/<epic>-task-<id>`, with `fix/<epic>/<issue>`
  opened only at the epic gate on failure. Story branches merge back `--no-ff` and are then deleted. The
  story branch joins the segment with a **hyphen** (not a slash) so it can coexist with the `feature/<epic>`
  ref — see `CONTRIBUTING.md` → Branching model.

## Persona → BMAD module map

| Persona | BMAD source | Used for |
|---|---|---|
| analyst, pm, ux-designer, architect, sm, tea, tech-writer | **BMM** module (`npx bmad-method install --modules bmm`) | the core SDLC roles + their workflows |
| tea + the `testarch-*` workflows | **TEA** module (`--modules tea`) | test design, framework, ci, trace, nfr, atdd, automate, test-review |
| worker / automator loop (`story-automator`, `story-automator-review`) | **automator** (`--modules automator`) | the per-story build→review automation in Phase 5 |
| worker (dev), investigator, retro | roles spun from BMM `dev`/`qa` + the `retrospective` workflow | implement stories, debug at the gate, write the epic retro |

See `AGENTS.md` for how to install these, initialize the persistent specialists, and track SDLC state, and
the `README.md` for the bootstrap.
