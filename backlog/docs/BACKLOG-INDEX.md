# GLA MVP backlog — index

Reference scenario: same-session browser handoff. **66 tasks**, ids `gla-001`–`gla-066`. Acceptance criteria state observable outcomes; the Definition of Done lives once in `backlog/config.yml` and is never restated per task. Dependencies form an acyclic order. Diagram: `docs/scenario-01-unified.html`.

## Foundation
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-001` | Plan the GLA system-architecture baseline | high | 8 | — |
| `gla-002` | Plan the shared kernel and cross-module contracts | high | 9 | gla-001 |
| `gla-003` | Scaffold the modular-monolith skeleton and quality gate | high | 6 | gla-001 |
| `gla-004` | Implement the shared kernel and contracts | high | 7 | gla-002, gla-003 |
| `gla-005` | Plan the dependency and ownership strategy | high | 6 | gla-001 |

## Dependencies (assembly reference) — `trad` = in-tree, `wpm` = installer package
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-005` | Plan the dependency and ownership strategy | high | 6 | gla-001 |
| `gla-006` | Integrate the Cedar policy engine | high | 5 | gla-005, gla-004 |
| `gla-007` | Build a wpm installer package for the browser runtime | high | 6 | gla-005 |
| `gla-008` | Build a wpm installer package for the human-view stack | high | 6 | gla-005 |
| `gla-009` | Build a wpm installer package for the capsule isolation runtime | high | 6 | gla-005 |
| `gla-010` | Build a wpm installer package for the edge proxy | high | 6 | gla-005 |
| `gla-011` | Build a wpm installer package for the identity provider | high | 6 | gla-005 |

## Row pairs — plan + impl per forward-cascade row

Plan tasks architect per touched component (one criterion each), classify dependencies, design the UX, and specify each seam at full capability. `check` rows reuse an earlier build and implement only the delta.

### enrollment
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-012` | Plan the recipient-enrollment step | medium | 8 | gla-002 |
| `gla-013` | Enroll a recipient so they can later be verified | medium | 5 | gla-004, gla-011, gla-010 |

### inbound
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-014` | Plan the inbound-request and agent-connect step | medium | 7 | gla-002 |
| `gla-015` | Receive a request and connect the agent | medium | 4 | gla-004 |

### orient
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-016` | Plan the agent-orientation step | medium | 6 | gla-002 |
| `gla-017` | Orient the agent against the install | medium | 4 | gla-004, gla-015 |

### propose
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-018` | Plan the propose-task-and-session step | medium | 7 | gla-002 |
| `gla-019` | Open a task and submit a session proposal | medium | 4 | gla-004, gla-017 |

### admit
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-020` | Plan the admit-the-proposal step | medium | 8 | gla-002 |
| `gla-021` | Admit a session proposal | medium | 5 | gla-004, gla-006, gla-019 |

### provision
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-022` | Plan the provision-the-capsule step | medium | 7 | gla-002 |
| `gla-023` | Provision the live capsule | medium | 4 | gla-004, gla-009, gla-007, gla-008, gla-021 |

### connector
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-024` | Plan the agent-connector step | medium | 7 | gla-002 |
| `gla-025` | Return an agent-blind connector to the agent | medium | 4 | gla-004, gla-023 |

### drive · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-026` | Plan the agent-drives-via-connector step | medium | 6 | gla-002 |
| `gla-027` | Drive the capsule autonomously over the connector | medium | 4 | gla-004, gla-025 |
| `gla-028` | Plan any change for the second autonomous-drive pass | low | 2 | gla-002 |
| `gla-029` | Drive the capsule to a second page without rebuilding | low | 2 | gla-027 |
| `gla-030` | Plan any change for driving while the session stays active | low | 2 | gla-002 |
| `gla-031` | Resume driving on an active session without rebuilding | low | 2 | gla-027, gla-025 |
| `gla-046` | Plan any change for the agent inspecting after the first window | low | 2 | gla-002 |
| `gla-047` | Inspect after the first window without rebuilding | low | 2 | gla-027, gla-045 |
| `gla-060` | Plan any change for the agent configuring the account | low | 2 | gla-002 |
| `gla-061` | Configure the account over the connector without rebuilding | low | 2 | gla-027 |
| `gla-062` | Plan any change for resuming after configuration | low | 2 | gla-002 |
| `gla-063` | Keep the session active through configuration without rebuilding | low | 2 | gla-027, gla-025 |

### handoff · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-032` | Plan the open-a-recipient-bound-window step | medium | 10 | gla-002 |
| `gla-033` | Open a recipient-bound handoff window onto the capsule | medium | 5 | gla-004, gla-010, gla-023, gla-015 |
| `gla-048` | Plan the re-open-onto-the-same-capsule delta | low | 2 | gla-002 |
| `gla-049` | Re-open a window onto the same capsule without rebuilding | low | 3 | gla-033 |

### auth · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-034` | Plan the user-authenticates-at-the-edge step | medium | 8 | gla-002 |
| `gla-035` | Verify the bound recipient at the edge | medium | 5 | gla-004, gla-011, gla-033, gla-013 |
| `gla-036` | Plan any change for returning the auth result to the gateway | low | 2 | gla-002 |
| `gla-037` | Return the verification result to the gateway without rebuilding | low | 2 | gla-035 |
| `gla-050` | Plan the auth-reused-on-re-open delta | low | 3 | gla-002 |
| `gla-051` | Reuse valid authentication on the second window without rebuilding | low | 3 | gla-035, gla-049 |

### reach · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-038` | Plan the verified-human-reaches-the-capsule step | medium | 7 | gla-002 |
| `gla-039` | Let the verified human reach the capsule surface | medium | 4 | gla-004, gla-035, gla-023 |
| `gla-052` | Plan any change for reaching the capsule on the reused-auth window | low | 2 | gla-002 |
| `gla-053` | Reach the capsule on the reused-auth window without rebuilding | low | 2 | gla-039, gla-051 |

### fill · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-040` | Plan the user-works-in-window-agent-blind step | medium | 5 | gla-002 |
| `gla-041` | Let the human work in-window without the agent seeing secrets | medium | 4 | gla-004, gla-039 |
| `gla-054` | Plan any change for the human entering the verification code | low | 2 | gla-002 |
| `gla-055` | Let the human enter the code agent-blind without rebuilding | low | 2 | gla-041 |

### detect · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-042` | Plan the detect-completion step | medium | 7 | gla-002 |
| `gla-043` | Detect completion of the human step | medium | 4 | gla-004, gla-041 |
| `gla-056` | Plan any change for detecting the second completion | low | 2 | gla-002 |
| `gla-057` | Detect the second completion without rebuilding | low | 2 | gla-043 |

### close · check (no-rewrite / delta only)
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-044` | Plan the close-the-window-and-resume step | medium | 8 | gla-002 |
| `gla-045` | Close the window and let the agent resume | medium | 4 | gla-004, gla-043, gla-033 |
| `gla-058` | Plan any change for closing the second window | low | 2 | gla-002 |
| `gla-059` | Close the second window without rebuilding | low | 2 | gla-045 |

### teardown
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-064` | Plan the tear-down-the-session step | medium | 9 | gla-002 |
| `gla-065` | Tear down the session and revoke everything | medium | 6 | gla-004, gla-023, gla-019, gla-033, gla-045 |

## End-to-end
| id | title | pri | ACs | depends on |
|---|---|---|---|---|
| `gla-066` | Pass the scenario-01 through-case end to end | high | 6 | gla-013, gla-015, gla-017, gla-019, gla-021, gla-023, gla-025, gla-027, gla-033, gla-035, gla-039, gla-041, gla-043, gla-045, gla-065 |
