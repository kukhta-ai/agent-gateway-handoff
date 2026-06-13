# identity-provider — bundle scope notes

These are **scope notes for the `identity-provider` bundle** of the `gla` project (version
`0.1.0`). They are not a second front door: the project root `AGENTS.md` and its install loop still
govern. By the agents' **closest-wins** rule, this file *refines* the root instructions while `identity-provider`
is your working directory, and any skills under this bundle's `installer-skills/` light up **in addition to**
the root's (a union) for the duration (doc 06, "Self-similar surfaces").

## What `identity-provider` stands up (bundle-specific scope)

This bundle configures the **WebAuthn/passkey provider** that proves the human recipient before the gateway
hands a session off (docs/03 §4). It has **two branches**, walked by the install-backlog as two trios:

- **Default — in-tree WebAuthn** (`step:detect-rp` → `configure-rp` → `verify-rp`). GLA's `@simplewebauthn`
  provider verifies passkeys **in-process**, so this branch stands up **no separate service**: its only action
  is setting the relying-party id (`GLA_RP_ID`) to match the host in GLA's public base URL (a bare IP is valid),
  from which the daemon derives the expected ceremony origin. This **in-tree-default decision is the
  load-bearing choice** this bundle documents.
- **Opt-in — delegated authentik over OIDC** (`step:detect-authentik` → `standup-authentik` →
  `verify-authentik`). Runs **only** when `GLA_AUTH_PROVIDER=authentik`; for the default it is a strict no-op
  and the RP trio is the whole story. GLA becomes an OIDC relying-party client (it dials only authentik's
  issuer + token/JWKS endpoints over the network). The authentik trio forks off the **shared detect** task
  (`detect-authentik` depends on `detect-rp`), so detection of the selection is done once.

### Key decisions, ownership, and host gotchas (record these — inspection cannot recover them)

- **Ownership mode is the load-bearing authentik decision.** `Local-External` (adopt a host-level authentik
  over the network — the **hermes-1 reference**), `Remote-External` (authentik already off-box), or `Managed`
  (stand a Compose stack up in-place). **Nested Docker inside the GLA container has a broken storage driver**
  (`unknown driver 'overlayfs'`) — a Compose stack fails partway — so **never attempt a Managed in-container
  standup unless `installer-scripts/check-nested-docker.sh` returns `NESTED_DOCKER_OK`**. On a host that can
  neither stand up nor adopt one, **stop with a clear, recoverable failure** and leave nothing half-built.
- **Inverse op only for what we installed.** An adopted authentik (Local-/Remote-External) carries **no**
  service inverse op; a `Managed` stack carries the teardown (`docker compose … down -v`). Record
  installed-vs-adopted either way.
- **The `amr` + `gla_uv` scope mapping is required and version-sensitive.** authentik 2025.10 emits an **empty
  `amr`** and does not distinguish passkey from password out of the box. Apply this bundle's **proven**
  `payload/templates/amr-scope-mapping.py` (with `amr-scope-mapping.md`) as a custom OAuth2 provider scope
  mapping; it matches GLA's default method map and emits `gla_uv:true` only for a UV-required passkey stage (no
  adapter change, no `GLA_AUTHENTIK_AMR_MAP` override). Without it the integration **safely degrades to
  password-only** (the adapter never up-maps) — **warn the operator**, and **verify the emitted `amr` and `gla_uv`
  against the running instance**.
- **Same-origin callback; no grant leak.** The `redirect_uri` must resolve to a **GLA-served page on GLA's own
  origin** (merge `payload/templates/caddy-authentik-callback.snippet` into the edge-proxy site block) so the
  OIDC `code`/`state` return to GLA and the **GLA grant never travels to authentik**.
- **Secrets are references, never literals.** The client secret lives behind the secret seam; never write it
  into the connection record, the `DependencyBinding` receipt, or any log
  (`payload/templates/dependency-binding.example.json` is the receipt shape; the whole authentik stack is **one**
  dependency from GLA's view).
- **Honest deferral.** A real authentik cannot run in a constrained build; where one is not available to probe,
  record the end-to-end method-distinguishing, UV-proof, and immutable-`sub` proofs as **deferred to the real
  deployment** rather than marking them satisfied. The deterministic strength mapping is already covered by
  `installer-scripts/smoke-amr-strength.mjs`; the real UV-proven passkey→`webauthn` round-trip lands at the deploy.

## What this bundle is

`identity-provider` is one independent, installable unit. Its parts:

- **`bundle.yml`** — the bundle's identity: its stable `id`, current `version`, user-facing `summary` (the menu
  line), `confirmation` level, and its `requires` map (the dependency contract). This is the structural source
  of truth; the operation writes it.
- **`install-backlog/`** — the **recipe**: a pre-initialized Backlog.md whose tasks walk
  **detect → setup → verify**, idempotently. Re-running it is Repair. Its `config.yml` carries a
  **Definition of Done** that makes recording the receipt a precondition for marking any task Done.
- **`payload/`** — everything the bundle delivers: `files/` and `templates/` placed into the environment, and
  `agent-skills/` (the runtime product, copied into the agent's scope at install).
- **`installer-skills/`** — optional install-time *helpers*, active only while this bundle is in focus (not
  pull-UX advisors — those stay at the project root).
- **`installer-scripts/`** — install-time tooling (probes, smoke tests) that runs during install; not delivered.

## How to work it

Work this bundle with `identity-provider/` as your working directory, walking `install-backlog/`'s tasks in
dependency order under the uniform loop — **detect → setup → verify → record**:

- **detect** whether the task's intent is already satisfied here (idempotent; skip if so);
- **setup** the step, honoring this bundle's `confirmation` level;
- **verify** the task's acceptance criteria actually hold (handing off to the user where a step needs them);
- **record** the receipt into the task **before** marking it Done — the install-backlog's Definition of Done
  gates this, so you cannot progress without it.

Record only what inspection cannot recover (installed-vs-adopted, the inverse op, an overwritten file, a chosen
value); the exact mechanics live in the project root installer skill's `references/journaling.md`. Contain any
failure to this bundle — never reach into another bundle's state, and never assume an undeclared prerequisite.
