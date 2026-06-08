# Journaling — the receipt recipe

The install **receipt is the task records themselves** — there is no separate state store. A reasoning
executor can re-derive presence, registration, and file integrity by looking, so you journal only the facts
you **cannot** recover by inspection, and you write them at the moment you act (the step erases its own
evidence). Backlog.md has a fixed task schema and no custom fields, so the receipt is shaped onto the real
fields, with every *enumerable* fact routed through typed fields rather than free text.

## Where each fact lives

| Receipt fact | Home | Notes |
|---|---|---|
| Files placed / modified | `--ref` | typed; later found via `search --modified-file`. The owned-files list, for free. |
| What "done" means | `--ac` | typed, checkable; doubles as the repair integrity check. |
| Per-task requirement (dependency) | `--dep` | typed graph edge; feeds shared-dependency removability. |
| Recording is mandatory | `definition_of_done` / `--dod` | the native gate — you cannot mark Done without it. |
| **Ownership: installed vs adopted** | structured notes block | a per-environment observation; lives next to the inverse op (read together at uninstall). |
| Inverse op (command + condition) | structured notes block | irreducibly free-form. |
| Checksum of a placed file | structured notes block | free-form value. |
| Decision + rationale | structured notes block | free-form. |
| Paused / awaiting external event | `status: Blocked` + a notes line | native lifecycle state; no special label. |

## How to write it

Prefer the **MCP server** (structured tool calls beat hand-built CLI strings). The universal fallback is the
CLI with `--plain` and `--append-notes`. Keep the notes block small — only the non-recoverable facts.

**Tags are reserved** for the recipe's structural vocabulary (identity `step:<slug>`, kind
`kind:state`/`kind:migration`, version milestone — see the versioning doc). Everything the executor observes
about *this* environment goes into the typed fields plus one structured notes block per task.

## Reading it back

- **Uninstall** walks the bundle's tasks (in `tasks/` and `archive/`), reads each notes block for the
  journaled ownership + inverse op, replays the inverse op only for steps recorded as *installed* (never for an
  *adopted* dependency), and decides shared-dependency removal from the `--dep` graph plus the still-installed
  bundles.
- **Repair** re-runs detection, re-checks each `--ac`, and reconciles drift by re-applying.
- **Config** files are compared against their recorded checksums; a user-modified file is preserved with
  keep / replace / merge offered.
