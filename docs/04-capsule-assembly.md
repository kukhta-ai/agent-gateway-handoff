# 04 · Capsule assembly — how the agent authors a session

> The agent never writes capsule config from scratch, and it never gets a planner. It authors a small **`AssemblySpec`** — a *delta* over a trusted **template**, filling only the cognition-shaped holes — and GLA *resolves, validates, and provisions* it. Every value the agent may set is bounded by a provider's typed `config_schema` (`02-provider-and-extension-model.md` §3.1), so authoring is **allowlist-by-construction**: the agent composes within a declared option set, never against open native config.

This is the agent-facing half of the **fat-agent / thin-system** split. Deciding *what the capsule is for* — which site, which success condition, which recipient — is cognition, and it belongs to the agent. Deciding *what is safe to run* — the isolation tier, the native runtime base, the agent-blind constraints — is enforcement, and it stays in trusted code. Assembly is the exact seam between the two, and the seam is drawn at install-time by the trusted template/provider author, not negotiated at runtime by the untrusted agent.

---

## 1. What the agent produces: the `AssemblySpec`

The artifact is a Kubernetes/Backstage-shaped object (`apiVersion` / `kind` / `metadata` / `spec`) — plain data with a published JSON Schema, which a coding agent generates the way it generates any typed payload. Each part references a registered provider by name (`use`) and carries `params` validated against that provider's `config_schema`. So `use` must name something registered *and* `available`, and `params` must conform to its declared option set — the registry and the schema bound what is even expressible. The capsule the spec describes is **assembled from separate local layers** — a browser plus its automation engine, the human-view stack, and the agent-control protocol — composed at provision time from independently installed components, **not shipped as one prebuilt image**. Each layer is a provider the spec names by capability (see `03-software-candidates.md`), which is why any one layer can be swapped without touching the others.

The realistic **minimal** spec for the reference browser-handoff capsule is tiny, because the template carries everything structural:

```json
{
  "apiVersion": "gla.dev/v1",
  "kind": "Assembly",
  "metadata": { "intent": "register on acme.example", "task": "T" },
  "spec": {
    "template": "browser-handoff",
    "recipient": "tg:user:123",
    "detectors": [
      { "use": "url-watcher",
        "params": { "complete_on": "/dashboard", "intermediate": ["/verify"] } }
    ]
  }
}
```

The agent supplied only three things, and all three are cognition: the **intent**, the **recipient** (passed through from the channel binding — never invented, and only ever narrowable), and the **completion targets** (its understanding of the site). Everything else — launcher, entrypoint, connector, workspace, the `user-done` detector, isolation tier, default TTL — comes from the template.

The **fully-specified** form makes the structure explicit and overrides a default or two; it is what the minimal spec resolves to, plus the agent's extras:

```json
{
  "apiVersion": "gla.dev/v1",
  "kind": "Assembly",
  "metadata": { "intent": "register on acme.example", "task": "T" },
  "spec": {
    "template": "browser-handoff",
    "recipient": "tg:user:123",
    "ttl": "1h",
    "launcher":    { "use": "docker", "params": { "memory": "1Gi" } },
    "entrypoints": [ { "use": "browser-stream", "params": { "viewport": "1280x800" } } ],
    "connector":   { "use": "cdp" },
    "workspace":   { "use": "browser-profile-temp" },
    "detectors":   [
      { "use": "user-done" },
      { "use": "url-watcher", "params": { "complete_on": "/dashboard", "intermediate": ["/verify"] } }
    ],
    "mounts": [
      { "host": "/home/op/proj/draft.md", "target": "/work/draft.md", "mode": "rw" },
      { "host": "/opt/style-guides",       "target": "/work/refs",      "mode": "ro" }
    ]
  }
}
```

`task` is optional: omit it and `session create` auto-creates (or attaches to) an implicit single-session task; name it only to thread several *independent* sessions under one goal. `entrypoints` is a list because one capsule may expose several human surfaces at once. `mounts` (optional) attaches host paths the agent can already reach into the capsule, in the mode it chooses — see §6.

---

## 2. The authoring flow — five moves

1. **Orient by capability, then introspect the template.** From the task the agent knows the *shape* it needs — "a browser a human can drive + an agent handle + completion detection" — and discovers what is available rather than assuming. `gla template show browser-handoff` returns the required part-families, the compatible/default providers per family, each backing dependency's binding status, template-level dependency evidence such as `edge-proxy`, and the template's **open-parameter schema** — which params it *must* fill (here `url-watcher.complete_on`) and which it *may*. `gla schema session create` gives the spec shape; `gla skill show browser-handoff` gives the recipe in prose. The agent learns the holes; it does not guess them. For mounts specifically, `gla policy mounts` returns the operator's allowed-set, denylist, and default mode — so the agent composes within the bound rather than discovering it by rejection.

2. **Start from the template.** A template is a *preset plus constraints*: it pins the structure and the security-bearing config and exposes only a small set of open parameters. The starting point is just `{ template, recipient }`.

3. **Fill the open parameters — the cognition.** The agent sets the task-specific values the template left open (the success URL, the intent, perhaps a TTL within range). These are precisely the things that require understanding the task, and they are what the agent writes into the spec.

4. **Override or extend, within compatibility.** If the defaults are not enough — a different *compatible* entrypoint, a second surface, a tighter memory limit, an extra detector — the agent overrides that part, but only with providers the template/catalog mark compatible (`relations.compatibleWith`) and only with `params` inside each provider's `config_schema`. It cannot swap in an unregistered provider or touch the native base.

5. **Validate, then submit.** Validate locally against the published schema (cheap), then dry-run against admission, fix in code, retry, and finally provision:

```bash
# introspect
gla template show browser-handoff
gla catalog show docker            # a provider's manifest, incl. its typed config_schema

# compose + admission-check only (mutate defaults -> validate; nothing provisioned)
gla session create --task T -f assembly.json --dry-run

# or compose imperatively, client-side, with typed --set:
gla session create --template browser-handoff \
  --recipient tg:user:123 \
  --set detectors.url-watcher.complete_on=/dashboard \
  --set launcher.memory=1Gi \
  --dry-run

# provision (drop --dry-run) -> {session_id, connector:{cdp_url, secret_ref}}
gla session create --task T -f assembly.json
```

Because the spec is data with an introspectable schema and a `--dry-run` checker that returns stable reject codes plus a skill pointer, the agent treats authoring like working against a type-checker: generate, validate, fix.

---

## 3. The option set is typed and provider-declared

Every value the agent may set lives inside some provider's `config_schema` — a closed root-object JSON Schema profile (the full vocabulary is in `02` §3.1: `properties`, root `required`, `default`, `enum`/`const`, range/length/pattern bounds, conservative composition, and `x-gla-sensitive` metadata). This is the mechanism that lets GLA offer **rich operator extensibility** without ever handing the agent open native config:

- the **operator / provider author** (install-time, trusted) decides which native knobs are exposed and their bounds — they "lower" the surface into a typed schema, once;
- the **agent** (runtime, untrusted) composes a config by setting values within that schema; anything off-menu is rejected, offline, at admission.

That is **allowlist-by-construction**, and it is the clean resolution of the otherwise-fragile "validate arbitrary runtime config for safety" problem. There is no arbitrary config; there is only conformance to a declared schema.

**Composition is a projection of the schema, not a hand-written command set.** The same `config_schema` is surfaced three equivalent ways, all generated from the one declaration: a declarative file (`-f assembly.json`), typed flags (`--set <path>=<value>`), and machine-readable introspection (`gla schema`, `gla catalog show`). New providers cost the author *a schema*, not a bespoke command per option — and there is nothing to keep in sync, because the flags and the file validate against the same schema. (`--set` is the typed form of the `--template <id> [parts…]` flags in `05-cli-and-entities.md`; `--set` and `catalog show` extend the command reference there.)

**Composition state is client-side.** The agent accumulates `--set`s (or writes the file), dry-runs, and submits *one* resolved `AssemblySpec`; GLA's edge stays stateless and the untrusted agent holds no server-side draft. (A server-side draft is possible but buys little here, so it is deferred.)

This shape is well-precedented; GLA is borrowing, not inventing:

- **Terraform** — each provider declares a typed schema that *is* the contract with its users (`Required` / `Optional` / `Default` / `ValidateFunc`, range and enum validators), and Terraform validates config against it **offline**, before any backend call. This is the model for `config_schema` and for dry-run-as-offline-validation.
- **kubectl** — imperative commands compose a manifest you then `--dry-run=client -o yaml` and apply, instead of writing YAML from scratch. Its *cautionary* lesson is equally load-bearing: hand-authored per-option commands cover only a subset of the real surface (`create deployment` has no `--replicas`; `expose` cannot set a nodePort), so they drift — which is exactly why GLA generates the option surface from one schema rather than hand-writing commands.
- **Firecracker** — a *runtime* that builds a microVM from a sequence of typed, validated config calls (`/machine-config`, `/drives`, `/network-interfaces`) before `InstanceStart`, *and* accepts the same thing as a single `--config-file`. That single-document / sequence equivalence is precisely `-f` vs `--set` over one schema.
- **`wpm`'s authoring CLI** (the in-project precedent) — a command surface that *verifies and records* a structured artifact and never authors content. GLA's composition follows the same rule for the `AssemblySpec`.

---

## 4. Resolution: template is the base, the agent's spec is the delta

The template is a *partial* `AssemblySpec` — defaults, the open-parameter schema, and compatibility constraints. The agent's submission is a thin **overlay**: a template reference plus overrides plus param values. Admission resolves and checks it in the same two stages every GLA object goes through:

- **Mutate** deep-merges template defaults with the agent's overrides into the *resolved* concrete spec. Agent overrides win **only on fields the template left open**; attempting to override a template-*fixed* field (the isolation tier, `privileged`, the namespace config) is a validation reject, not a silent override. It also **canonicalizes** each mount's host path — resolve symlinks, make absolute, collapse `..` — so the allowed-set check downstream runs on the real path, never a string that `../`-escapes it.
- **Validate** checks the resolved spec: Cedar policy (forbid-wins), capability scope, catalog availability of every `use`d provider, the recipient / identity, and each part's `params` against its provider's `config_schema`; and each **mount** against the operator allowed-set and the catastrophic denylist (Cedar, forbid-wins), its mode, target collisions, and the chosen launcher's declared **mount capability** — all offline, so `--dry-run` catches them. Runtime existence and readability are not checked here; they are OS-enforced at spawn (§6).

So the agent submits a delta and never has to know — or get right — the full resolved spec; the system owns resolution. This is the Kustomize-over-base overlay model joined to Kubernetes admission (mutate → validate), and it is grounded: the source docs already specify admission's mutate-then-validate and "template defaults injection" — a high-level template name fills in the workspace / launcher / entrypoint / connector defaults.

---

## 5. The fixed / open boundary is the cognition / enforcement line

Authoring is safe because the boundary between *what the template fixes* and *what the agent fills* is the same line as cognition-vs-enforcement, and it is drawn by a trusted party:

**Fixed by the template and the launcher beneath it** (the enforcement half): the isolation tier; the launcher's native base (no privileged, correct namespaces, the agent-blind constraints) in `runtime_base`; the entrypoint↔connector wiring; and the set of compatible providers.

**Filled by the agent** (the cognition half, and only what the schemas expose): the completion targets; the intent; the recipient (passed through from the channel binding); a TTL within range; non-secret env; resource limits within range; optional extra surfaces or detectors drawn from the compatible set; and which host paths to mount, and in what mode (§6).

Where that line sits is the template / provider author's `required`-vs-`optional` decision — Terraform's exact knob, made at install-time. The agent reaches the native layer in only two sanctioned ways, both covered in `03` §7: by **authoring a new template or `Launcher` through the contribution workflow** (reviewed, then trusted), or, in a **trusting deployment profile**, by supplying fuller native overrides validated against a Pod-Security-Standards-style safety baseline (`restricted` / `baseline` / `privileged`). By default — the strict or multi-tenant profile — the agent only parameterizes a trusted template.

---

## 6. Attaching host files: the agent's mounts

A capsule routinely needs things from the host — an input document, a working directory, reference files, a dependency on disk — and the draft → edit → persist loop needs the result to *survive* reap. The governing fact is that **the agent runs outside the capsule, with its own filesystem view** (it reaches GLA through the Agent Bridge): a host path it asks to mount is one it can already read, so mounting it grants the agent nothing it did not already have. The mount question is therefore not "may the agent see this" but "what should the *capsule* — an exposed surface that may render untrusted web content — be able to touch, and what is the agent allowed to mount *as itself*."

For the main case — a **single-operator deployment whose recipient is the operator** — the answer is simply: **the agent mounts host paths freely, read or read-write, in the mode it chooses.** It is the operator's own machine, files, and tool, and this is the ordinary devcontainer / compose-dev posture. The agent expresses each mount in the spec:

```jsonc
"mounts": [
  { "host": "/home/op/proj/draft.md", "target": "/work/draft.md", "mode": "rw" },  // edited live, persists on host
  { "host": "/opt/style-guides",       "target": "/work/refs",      "mode": "ro" }   // reference input
]
```

Persistence is just an `rw` mount: the human edits `/work/draft.md` in the capsule and the bytes land on the host at `/home/op/proj/draft.md`, surviving teardown because they were never the capsule's to destroy. (A managed **outputs root**, plus the **task** as a durable cross-session artifact store, is offered as a convenience for results the agent would rather hand back by handle than pin to a path — but it is one door, not the only one.)

Three things stay true regardless, and they are the genuine minimum the trusted core keeps:

- **Mounts run with the agent's own authority.** GLA realizes a mount as the agent itself could — so the agent can attach anything it can already reach, but a mount request can never become a lever to make GLA surrender **GLA-managed, agent-blind** resources the agent cannot itself see. Secrets and dependency credentials are exactly such resources: the agent never sees them, so they are never mountable by request — they keep flowing through the secret-injection and `DependencyBinding` paths (agent-blind, `tmpfs`, injected at the boundary). This is the confused-deputy line, and it costs the agent nothing over its own files. Concretely, the worker realizes the mount by running the capsule process as the **agent's own uid** with privilege-escalation off, so the kernel's DAC enforces exactly the agent's access — a path the agent itself cannot read fails closed, with no separate check for Admission to get right.
- **The host footprint is the operator's to bound.** Mechanically a mount is checked against an operator **allowed-set**, exactly the way every other field is checked against a schema at admission — except this set defaults *permissive* for the single-operator profile (up to `*`). The bound is a dial, not a wall: wide open by default locally, narrowable when the deployment is shared.
- **Recipient-scoping is a future seam.** When handing off to a recipient who is *not* the operator eventually matters, the allowed-set narrows *for those handoffs* — the agent's own visibility is not a third party's entitlement. It never constrains the operator case.

The one optional guardrail, default-on but a single line for the operator to remove: a small **denylist of catastrophic paths** (the Docker socket, `~/.ssh`, the GLA state dir) so they are not `rw`-mounted into a web-browsing capsule by accident. A seatbelt, not a wall.

On the surface, a mount is one entry in `spec.mounts` or one repeatable flag — `gla session create … --mount /home/op/draft.md:/work/draft.md:rw`. `mode` defaults to `ro`; `target` defaults to `/work/<basename>`. The agent composes mounts exactly as it composes the rest of the spec, and `--dry-run` validates them offline against the allowed-set, denylist, mode, and launcher capability before anything is provisioned.

Mounts are also gated by the **launcher's** declared mount capability — each runtime states in its manifest which host mounts it can realize (file or directory, `ro`/`rw`). This is the honest answer to *the agent runs outside, but the capsule may not share its host*: a remote or other-host launcher declares no host mounts, admission rejects them, and the agent falls back to GLA-mediated transfer (upload / the task store). Host-path mounting works precisely when the capsule shares the operator's host — the reference case.

The split is the same cognition / enforcement line as everywhere else: *what to mount and in what mode* is cognition and belongs to the agent; the trusted core keeps only the agent-authority bound, the operator's allowed-set, and (later) recipient-scoping. Read-only is a sensible default for pure inputs — the agent reading a file does not mean the throwaway browser should be able to rewrite it — but it is a default the agent overrides by asking, not a restriction.

---

## 7. When no template fits

The agent *can* assemble from scratch by capability: query the catalog for parts providing each needed capability ("entrypoints that give a human browser surface", "connectors providing CDP", "detectors keyed on URL"), pick a compatible set (relations declare compatibility), and parameterize each within its schema. It is the harder path, and the template is the shortcut that exists so the agent rarely needs it. A *recurring* new pairing is not rebuilt per session — it is promoted to a new `CapsuleTemplate` via the contribution workflow, so the curation happens once, in trusted hands.

---

## 8. Invariants

- The agent authors a **delta over a template**, never raw native config; the native base is owned by the trusted provider / template author.
- Every value the agent sets conforms to a provider's **typed `config_schema`**; off-schema input is rejected offline at admission (**allowlist-by-construction**).
- The **fixed / open line is set at install-time** by a trusted author, never negotiated by the runtime agent.
- Admission **resolves** (mutate-merge) then **validates**; the agent never has to produce the full resolved spec.
- Composition is **client-side**, and the option surface is a **projection of one schema** (`-f` ≡ `--set` ≡ `gla schema`), so a provider costs a schema, not a command set.
- **Mounts run with the agent's own authority** — the agent may attach what it can already reach, never GLA-managed, agent-blind resources (secrets, dependency creds) it cannot itself see.
- *What to mount and in what mode* is the **agent's choice**, bounded only by an operator **allowed-set** that defaults permissive for the single-operator profile.
- **Persisted bytes live on the host** (a mount target, or the outputs root / task store) and survive reap; only the capsule's **own ephemeral** state is destroyed at teardown.
- Host mounts are gated by the **launcher's declared mount capability**; a launcher that cannot share the host (a remote worker) accepts none, and the agent falls back to GLA-mediated transfer.

---

## Provenance

**Grounded in the source docs:** the `AssemblySpec` as a K8s/Backstage-shaped, JSON-Schema-validated object; admission's mutate-then-validate with Cedar (forbid-wins); "template defaults injection"; parts as catalog kinds discovered by capability; recipient-binding (narrowable only); `--dry-run`; the implicit single-session task; the native-bottom / thin-top split; the agent running outside the capsule (the Agent Bridge); the agent-blind secret-ref and `DependencyBinding` channels; the task as durable cross-session root; reap destroying the capsule's ephemeral workspace; and the two sanctioned native-access paths (contribution workflow; PSS-style profile tiers).

**Synthesized / sharpened here:** the concrete `AssemblySpec` object shape (`use` / `params`, the minimal-vs-full spectrum), the five-move authoring flow, the template-as-overlay / agent-as-delta resolution framing, the "fill the cognition-shaped holes" boundary, the typed-`config_schema` composition mechanism (introspect → `--set` / `-f` → `--dry-run`, client-side, allowlist-by-construction) with its Terraform / kubectl / Firecracker / `wpm` precedents, and the **host-attachment / mount model** (§6) — free agent-chosen `ro`/`rw` mounts for the operator-recipient case, the confused-deputy authority bound, the operator allowed-set defaulting permissive, recipient-scoping as a future seam, and the catastrophic-path denylist — grounded in K8s Pod Security Standards (host access reserved for trusted profiles) and Docker mount semantics (managed volumes / `tmpfs` / `:ro`). The composing-flow integration (the `--mount` flag, `gla policy mounts`, canonicalize-before-validate at admission, the per-launcher mount-capability gate, and uid-scoped mounting as the structural enforcement) is the mechanism folded in here.

## Related

`02-provider-and-extension-model.md` (§3.1 the typed `config_schema` vocabulary; §7 the capsule runtime as a `Launcher`), `components/admission-and-policy.md` (mutate → validate, Cedar), `components/catalog.md` (the registry the spec is validated against), `components/capsule.md` (what the assembled spec becomes — one capsule, one or more surfaces, mounted host paths), `components/worker-plane.md` (the spawner that realizes the mounts), `components/session-service.md` (the session the assembly creates), `05-cli-and-entities.md` (`session create`, `template show`, `catalog`, `schema`), `03-software-candidates.md` (the concrete software per layer this assembly composes), `scenario-01-unified.html` (the assembly in a full end-to-end run).
