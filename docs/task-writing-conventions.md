# Task & Acceptance-Criteria Conventions

How tasks are written in this project: what a task contains, and — the part that matters most — how to
write acceptance criteria that state the **outcome** (the *what*) rather than the **method** (the
*how*). This is a standards document; it governs both backlogs this project produces.

## Scope: this applies to two backlogs, for the same reason

These conventions hold in two places, and they hold for the *same* underlying reason:

1. **wpm's own development backlog** — the tasks that build the tool (`FOUNDATION.md`, `backlog/`).
2. **The work-packages authors ship** — every bundle wpm packages is itself a Backlog.md backlog of
   tasks-with-acceptance-criteria that a *recipient's agent* executes (`00`, `07`).

In both, the task is **read and carried out by a reasoning agent operating in an environment the author
never saw**. That single fact is why the *what*/*how* discipline below is not stylistic preference but
a correctness requirement. A task is the contract between the person who wrote it and the agent that
fulfills it; the criteria are the contract's terms.

---

## The principle

> **Acceptance criteria state what must be observably true when the task is done — never the steps taken
> to get there.**

A criterion describes a *condition the world is in*, checkable from outside, independent of method. It
does not describe an action, a sequence, or an implementation. If a criterion tells the executor *how*
to proceed, it is mis-written.

## Why — the general reason

This is ordinary, well-established product-management and behaviour-driven-development practice, and the
reasons are the usual ones:

- **A criterion is a contract, not a recipe.** It fixes the definition of success and leaves the means
  open. Product owns the *what* (the outcome and its value); the implementer owns the *how*. Mixing them
  over-constrains the implementer and smuggles design decisions into the requirement.
- **Outcomes are verifiable; steps are not.** "The command rejects an invalid manifest" can be observed
  to be true or false. "Add a validation loop" cannot be *checked* — only *read* — so it can't tell you
  whether the task succeeded.
- **The method will change; the outcome shouldn't have to.** Phrase the criterion as an end state and it
  survives refactors, library swaps, and better ideas. Phrase it as steps and it rots the moment the
  implementation moves.
- **It keeps the task negotiable and testable** — two of the qualities a good unit of work is supposed
  to have (cf. INVEST: *Independent, Negotiable, Valuable, Estimable, Small, Testable*). A *how* removes
  the negotiation and often isn't testable.

## Why — the reason specific to this project

The general case is reinforced by wpm's core bet (`00`): *intent plus verification, executed by a
reasoning agent, beats fixed steps executed by a dumb engine — exactly when the environment is unknown.*
Two consequences make the discipline non-optional here:

- **Prescribing the *how* destroys the adaptation that is the entire point.** The agent's value is that
  it inspects the actual machine and chooses a method that fits it. A task that dictates the method
  replaces that adaptation with a guess made by an author who couldn't see the target — which is the
  brittle setup-script failure mode wpm exists to escape. State the outcome; let the agent find the path
  to it on the machine in front of it.
- **The acceptance criterion *is* the verification that travels inside the bundle.** Because the author
  can't pre-test the user's environment and the agent's choices aren't fixed, each bundle must carry its
  own proof of success. The acceptance criteria *are* that proof — the observable conditions the agent
  checks to know it's done, and the basis of the receipt, repair, and idempotent re-runs (`00`, `07`,
  `08`). A criterion written as steps cannot serve as proof; only an observable end state can.

So: a *how*-criterion is not merely less tidy here. It removes the agent's adaptation **and** leaves the
bundle with nothing to verify against. Both halves of the bet break.

---

## Anatomy of a task

A task carries four things that the author writes, plus status that the executor maintains.

| Field | Purpose | Voice |
|---|---|---|
| **Title** | Names the deliverable in one line — the capability or artifact this task lands. | Noun-ish, outcome-named: *"Implement the validate service"*, not *"Work on validation"*. |
| **Context / description** | *Why* this task exists and what it enables; links to the design docs that frame it. Orients the executor. | Prose. Explains intent and boundaries — **not** a how-to guide. |
| **Acceptance criteria** | The observable conditions that make it done. The contract. | Declarative end-states (see rules below). |
| **Dependencies** | Which tasks must precede this one. Kept acyclic; the set forms a valid build order. | `requires` references. |
| **Non-goals** *(optional, recommended)* | What this task explicitly does *not* cover — prevents scope creep and tells the executor where to stop. | Short list of excluded outcomes. |

The **context** sets intent and the **acceptance criteria** fix the result; between them the executor
has everything needed to choose a method and prove the method worked. Nothing in the task should read
like a sequence of instructions.

## The acceptance-criteria rules

1. **State an observable condition, not an action.** *"Invalid input is rejected with a typed error and
   a non-zero exit code"* — not *"add a try/catch that throws and calls exit"*.
2. **Make each criterion verifiable from the outside.** Someone (or a test, or the executing agent) can
   confirm it's true by observing behaviour at the component's boundary, without reading the
   implementation. If you can't check it without looking inside, rewrite it.
3. **One concern per criterion.** Split compound criteria. Each should map cleanly to one thing you could
   test.
4. **Write declaratively (the end state), not imperatively (the steps).** *"All defects are reported in a
   single pass"* — not *"loop over the fields and push errors"*.
5. **Cover the negative and the edges as outcomes too.** Error behaviour, boundaries, and "does nothing"
   guarantees are criteria, not afterthoughts: *"Validation has no side effects"*; *"A missing path
   surfaces a catchable error rather than an unstructured throw"*.
6. **Don't restate the Definition of Done.** The universal quality bar (below) is not repeated per task.
7. **Don't encode order or mechanism** — unless the mechanism is part of the contract (next section).

## The test for *what* vs *how* — and the one nuance

A fast classifier for any criterion you've written:

> **Could two competent implementers satisfy this with completely different code?**
> - **Yes** → it's a *what*. Keep it.
> - **No — it forces one implementation** → it's a *how*. Rewrite it as the outcome that implementation
>   was supposed to produce.

The nuance that trips people up: **some mechanisms *are* the outcome**, because they're observable at the
boundary and something else depends on them. Naming those is legitimate — they are *what*-statements
about a contract, not *how*-statements about internals. The deciding question:

> **Is the named thing observable at the component's boundary — part of the interface something else
> relies on — or is it an internal choice invisible from outside?**

| Naming this is a **contract** (allowed) | Naming this is an **implementation detail** (disallowed) |
|---|---|
| Exit codes (`0`/`2`/`1`) — other programs branch on them | Which control-flow or data structure produced them |
| A file format / lockfile schema others read | Which serializer library wrote it |
| A content hash used for tamper-evidence (the *guarantee*) | Which hash algorithm, when no interop pins it |
| A port's method shape — the seam the core depends on (`13`) | Which concrete adapter or I/O library backs it |
| A typed, machine-distinguishable error *kind* | The class hierarchy used to model it |

Rule of thumb: **specify the seam, leave the stuffing.** If callers, other programs, or a public format
depend on it, it's part of the *what*. If it's only visible by reading the source, it's *how*.

## Acceptance criteria vs Definition of Done

These are different and must not be conflated:

- **Definition of Done (DoD)** — the *universal* quality bar applied to **every** task, declared once in
  `backlog/config.yml` (typecheck clean, Biome clean, tests added and green, public functions
  documented, no dead code, the core import-boundary not violated). It is **not** restated in any task.
- **Acceptance criteria (AC)** — the *task-specific* outcomes unique to this piece of work.

A task is complete when **its acceptance criteria are met *and* the Definition of Done is satisfied.**
Authors write the AC; the DoD is assumed. (For shipped bundles, the analogous "done" contract is the
install contract in `07`.)

## Formats you may use

- **Plain declarative end-states** — the default, and right for structural/capability criteria: *"Core
  code depends only on the port; swapping adapters changes no core code."*
- **Given / When / Then** — useful for behavioural criteria because it forces an observable outcome:
  *"Given a malformed manifest, when validate runs, then each distinct defect is reported with its
  location and the command exits non-zero."* Use it where it clarifies; don't force it onto structural
  criteria.
- **INVEST** — not a format but a sanity check on the *whole* task. If a task isn't *Testable*, its
  criteria are probably *how*-statements or vague; if it isn't *Negotiable*, you've over-specified the
  method.

---

## Worked rewrites

Each pair shows a criterion as *how* (wrong) and the same intent restated as *what* (right). These mirror
the style of the foundational backlog.

**A port and its adapters**

```
✗ HOW   Create a FileSystemAdapter class with readFile/writeFile that call node:fs/promises,
        and an in-memory version backed by a Map, injected via the constructor.

✓ WHAT  · A FileSystem port defines the file operations the core needs, with no dependency on a
          concrete I/O library.
        · A real adapter satisfies the port against the actual filesystem; an in-memory adapter
          satisfies the same port for tests.
        · Core code depends only on the port — swapping adapters changes no core code.
        · Reading a missing path surfaces a typed, catchable error, not an unstructured throw.
```

**A validation service**

```
✗ HOW   Loop over each manifest field, check it with an if-statement, and push error strings
        into an array.

✓ WHAT  · A well-formed manifest passes with no diagnostics.
        · Each distinct defect is reported as a separate, human-readable diagnostic that names
          the offending location.
        · All discoverable defects are reported in a single pass, not just the first.
        · Validation has no side effects: it reads, it reports, it changes nothing.
```

**Integrity / lockfile** *(note: the hash is named because tamper-evidence is the contract; the
algorithm is not, because nothing external pins it)*

```
✗ HOW   Run SHA-256 over each file in a for-loop and compare the hex strings.

✓ WHAT  · Each vendored item is recorded with its source version and a content fingerprint.
        · Re-vendoring byte-identical content reproduces an identical fingerprint.
        · Any change to vendored content is detected as a mismatch against the recorded value.
```

**CLI failure behaviour** *(exit codes are named because other programs depend on them — a contract)*

```
✗ HOW   Wrap main() in try/catch, print err.message, and call process.exit with the right number.

✓ WHAT  · On success the command exits 0.
        · On a user or input error it exits 2 and prints a message naming what to fix.
        · On an unexpected internal failure it exits 1.
        · Failure types are machine-distinguishable so callers can branch without parsing prose.
```

## Anti-patterns

- **Implementation-as-criterion** — *"Use a Map to store…"*. State the observable behaviour instead.
- **A plan disguised as criteria** — numbered steps (*"1. Create file 2. Add function 3. Export"*).
  That's a method, not a contract.
- **Untestable vagueness** — *"Code is clean and well-structured."* Not observable; it belongs to the
  DoD, or must be restated as something checkable.
- **Restating the title** — a criterion that repeats the task name and adds no observable condition.
- **Over-specification** — pinning internal details that aren't part of any boundary or contract.
- **DoD repetition** — re-listing "tests pass / typechecks" in a task's criteria.

## Author checklist

Before a task is considered well-formed:

- [ ] The **title** names a deliverable, not an activity.
- [ ] The **context** explains *why* and *what it enables* — and contains no step-by-step *how*.
- [ ] Every **acceptance criterion** is an observable end-state, checkable from outside.
- [ ] Each criterion holds **one** concern and is, in principle, **testable**.
- [ ] The **negative/edge** outcomes (errors, boundaries, "no side effects") are covered.
- [ ] No criterion forces a single implementation — except where it names a genuine **boundary
      contract** (interface, format, exit code, observable guarantee).
- [ ] The **Definition of Done** is *not* restated; **dependencies** are listed and acyclic.
- [ ] Two competent implementers could satisfy every criterion with different code.

## How this lives in Backlog.md

Tasks are created and edited **only through the Backlog.md CLI**, never by hand-editing files (see
`AGENTS.md`). Acceptance criteria go in the task's criteria field; statuses (`To Do` / `In Progress` /
`Done`) are maintained by the executor as work proceeds and are the source of truth for progress.
Dependencies are expressed as `requires` references and must keep the graph acyclic — the dependency
order *is* a valid execution order. For the authoring workflow that produces these tasks, see `11`; for
the install contract a shipped bundle's criteria ultimately serve, see `07`.
