# 02 · Provider & extension model

> GLA is extended by **inversion of control**: providers describe themselves and register *into* the core's registries, and every other part of the system is *registry-driven* — it asks "what's available and what can it do?", never carrying a hard-coded list. The **operator** extends GLA at install-time; the **agent** consumes the registry at runtime.

This is the spine for every point where GLA leans on a third party to cover a capability — the capsule runtime, channels, auth, secret stores, document editors, completion detection. They are all the same kind of thing, extended the same way, and the goal is that an operator can add a capability by *dropping in a package*, never by editing the core.

---

## 1. The principle: inversion of control

The core does not reach out to a fixed set of integrations. Instead:

- the core holds **registries** (one generic mechanism, many families);
- a provider **registers into** a registry by shipping a self-describing manifest;
- everything else is **registry-driven** — it discovers providers *by capability* and works with whatever is registered.

Adding a capability is therefore adding a *package*, not changing core code. Discovery is by capability ("what launchers exist, and what isolation can they give me?"), not by a name the core had to know in advance. And because the mechanism is uniform, the capsule runtime extends by exactly the same path as a chat channel or an auth provider — there is no special case.

---

## 2. Two clocks: who extends, and when

"Directed from them to core" has to mean two separate clocks, because the runtime agent is untrusted.

| | **Install-time** | **Runtime** |
|---|---|---|
| Actor | the **operator** (often via their agent + `wpm`) | the **untrusted agent** |
| Action | install a provider package; it self-describes; the core **ingests** it | **consume** the registry: compose and parameterize registered providers |
| On the registry | writes (a new entity + binding is registered) | reads only — never mutates |
| Trust | the provider is trusted code the operator chose to install (reviewed) | the agent is untrusted by design |

So **"self-registration" means a package describes itself so the operator's install is turnkey** (drop it in → it manifests → it's usable) — *not* an open endpoint that anything pushes code to at runtime. This is the existing GLA↔`wpm` split: `wpm` (the agent-native installer) stands the dependency up on the operator's host and writes its `DependencyBinding`; GLA reads it. Extensibility is an operator power; the runtime agent only ever consumes what's already registered. This is the line that lets GLA be maximally extensible *and* keep providers trusted — which matters most for launchers, since they run code and own security-bearing configuration (§7).

---

## 3. The uniform provider contract

Wherever GLA depends on a third party for a capability, it is the *same* kind of artifact: a **provider package** = a self-describing **manifest** + code + skills + a contract/health probe. The four artifacts are inseparable — a contribution that adds code without skills, or with a stale manifest, fails review.

The provider families (the pluggable kinds backed by third-party code or dependencies):

`Launcher` (the capsule runtime) · `HumanEntrypoint` · `AgentConnector` · `Workspace` · `CompletionDetector` · `Sidecar` · `ChannelAdapter` · `AuthProvider` · `SecretStore` · `Dependency` · `CapsuleTemplate`.

(The same registry also holds operator-*authored* kinds — `AuthorityProfile`, `PolicyProfile`, `Skill`, `Location` — but those are configuration, not third-party providers; this doc is about the provider families above.)

Every provider's manifest declares the same fields, regardless of family — this is how a dependency "manifests itself":

| Field | What it declares | Consumed by |
|---|---|---|
| identity | name, version, **family/kind** | the registry index |
| capability | what it provides, so it can be found *by capability* (for a `Launcher`, incl. which host mounts it can realize) | assembly, discovery |
| config schema | the **typed** option surface the **agent** may set (§3.1) | `gla schema` / `catalog show`, admission |
| required dependencies | what must be stood up on the host | `wpm` (a bundle) |
| probe | the health / contract check proving it actually works | doctor, ingest |
| skills | how an agent uses it | the Skill Manifest |
| relations | compatibility (e.g. which entrypoints/connectors it pairs with) | admission, assembly |

A provider manifest follows the Kubernetes/Backstage object shape (§ in `01-architecture-overview.md`). Example — a new capsule-runtime backend:

```yaml
apiVersion: gla.dev/v1
kind: Launcher
metadata:
  name: firecracker
  version: 0.2.0
spec:
  family: launcher                 # the capsule-runtime family
  capability:
    isolation_tier: microvm        # discoverable: "give me a microVM launcher"
    summary: "Firecracker microVM capsule runtime"
    mounts: { host_paths: [file], modes: [ro, rw] }   # which host mounts this runtime can realize
  config_schema: ./schemas/params.json    # the agent-parameterizable surface (thin top, §7)
  runtime_base: ./base/                    # the trusted native config (owned here, NOT agent-authored)
  requires:                                # host deps -> stood up by a wpm bundle
    - dependency: firecracker-bin
    - dependency: kvm-access
  probe: ./probe.sh                        # health/contract probe -> doctor
  skills:
    - ./skills/use-firecracker-launcher/SKILL.md
relations:
  compatibleWith:
    entrypoints: [browser-stream, novnc]
    connectors: [cdp, ssh]
```

### 3.1 The `config_schema` vocabulary — the agent's option set

`config_schema` is the single most load-bearing field for keeping the agent useful *and* contained: it is the **typed, declared set of options the agent may set** on this provider, and nothing outside it is expressible. The vocabulary borrows directly from the way a Terraform provider declares its schema — where that schema is the *contract* between the provider and its users, validated **offline** (before any backend call) and **early** (catch bad combinations at plan, not at apply):

| Key | Meaning |
|---|---|
| `type` | `string` / `number` / `bool` / `enum` / `object` / `list` |
| `required` / `optional` | must the agent set it, or may it |
| `default` | value applied when the agent omits it (filled at admission-mutate) |
| `enum` | the closed set of allowed values |
| `min` / `max` / `pattern` | range and format constraints |
| `conflicts_with` / `required_with` | cross-field rules |
| `sensitive` | never echoed in `schema` / `catalog` output or logs (a secret-ref, never a literal) |

Example — a `docker` launcher's `config_schema` (the "lowered" surface; the rest of the Compose/run config stays fixed in `runtime_base`):

```jsonc
{
  "memory":    { "type": "string", "optional": true, "default": "512Mi", "pattern": "^[0-9]+(Mi|Gi)$" },
  "cpus":      { "type": "number", "optional": true, "default": 1, "max": 4 },
  "image_tag": { "type": "enum",   "optional": true,
                 "enum": ["chromium-stable", "chromium-beta"], "default": "chromium-stable" }
  // privileged, namespaces, seccomp, the launcher's own base mounts: NOT here — fixed by the trusted author in runtime_base
}
```

Two consequences follow, and they are the whole point:

- **Allowlist-by-construction.** The agent never submits arbitrary native config that GLA has to screen for safety; it can only set values that *conform to a declared typed schema*, checked offline at admission. "Validate untrusted runtime config for safety" — the hard, fragile problem — dissolves, because there is no arbitrary config to validate, only schema conformance.
- **The trusted author draws the line.** *Which* native knobs become options, and their bounds, is decided by the provider/template author at install-time (every `required` / `optional` / `enum` / range choice). That is exactly the cognition-vs-enforcement boundary — fixed once by a trusted party, never negotiated by the runtime agent.

How an agent *composes* a spec against these schemas — introspect → `--set` / `-f` → `--dry-run` → submit — is the subject of `04-capsule-assembly.md`.

---

## 4. The registry and the ingest pipeline

The **Catalog** is the generic registry: **Store** (git-tracked YAML) → **Ingester** (a mutate-then-validate pipeline) → **Index** (a queryable view whose availability is *system-derived*). Ingest is uniform across families:

1. Read the manifest from the Store.
2. **Mutate** — apply defaults, resolve cross-references and relations.
3. **Validate** — the manifest conforms to its family schema; relations resolve; the `config_schema` is itself valid JSON Schema.
4. **Register the code** with its family registry — a `Launcher` with the Spawner Registry, a `ChannelAdapter` with the channel registry, and so on.
5. **Run the contract test + probe** — the code conforms to its manifest, and the dependency actually answers.
6. **Register its skills** with the Skill Manifest.
7. **Index it** with system-derived availability (`available` / `degraded` / `unavailable`, computed from its binding and probe).

Two properties matter: availability is **derived, never author-declared** (a provider whose probe fails shows as unavailable, so admission rejects assemblies that need it); and the index supports **capability discovery** — "what's available that provides X" — not just lookup by name.

---

## 5. Registry-driven everywhere: the shared read interface

The point of the inversion is that **one read interface is consulted by every command and flow, and nothing hard-codes a provider list**:

- the CLI — `gla catalog / template / skill list|show`, and `gla schema`;
- admission / policy — an assembly is valid only against what is registered *and* available;
- assembly composition — the agent picks and parameterizes registered parts, discovered by capability;
- the worker / spawner — spawns via the registered `Launcher`;
- doctor — probes registered dependencies;
- the Skill Manifest — serves the skills providers registered.

The consequence is the property you want: **register a provider once and it is instantly visible and usable across the whole surface** — including in the agent's runtime introspection (`gla schema` / `catalog`) and in assembly — with zero core changes.

---

## 6. Dependency vs provider — two sub-kinds, one mechanism

Two things register the same way and are worth keeping distinct:

- a **Dependency** is an external *resource* GLA needs (a Vault, a browser pool); its manifest carries its binding, its health, and which **ownership mode** it's in;
- a **provider/plugin** is *code* implementing a family (a `Launcher`, a `ChannelAdapter`); its manifest carries its capability and config schema.

Both self-describe and are consumed registry-driven. `DependencyBinding` is precisely the dependency side of this inversion — written by `wpm`, read by GLA. A dependency declares one of five ownership modes, which is just *who runs it and who wired it*:

`Managed` (GLA-installed) · `Local-External` (operator-run, same host) · `Remote-External` (operator-run, elsewhere) · `Manual-BYO` (operator supplies endpoint + creds) · `Disabled` (capability off).

---

## 7. The capsule runtime is an instance of this model

The runtime backends — Docker, Podman, Kubernetes, Firecracker, a remote-worker service — are **`Launcher` plugins that self-register via the Spawner Registry**, under the contract in §3. The Spawner is the abstraction (the JupyterHub pattern); adding a launcher type is adding a Spawner plugin. The tiers are attributes of `Launcher` entities: `none` (T0), `local-process` (T2), `systemd-user` (T2/T3), `rootless` (T3), `docker` (T4), `remote-worker` (T5).

This is where the **native-bottom / thin-top** split (from the assembly model) physically lives:

- the **native base** — the backend's own config (Compose, a Pod spec, a Firecracker config), authored by the *trusted* plugin author and carrying the security-bearing decisions (no privileged, correct namespaces, agent-blind constraints) — is the manifest's `runtime_base`;
- the **agent-parameterizable surface** — image, non-secret env, resource limits within a range, which surfaces, completion conditions — is the manifest's `config_schema`, a *typed* option set (§3.1).

Host-path **mounts** are a third, *agent-controlled* surface alongside these: the agent chooses which host paths to attach and in what mode, because it runs outside the capsule and can already reach them (full model in `04-capsule-assembly.md` §6). Mounts are realized with the agent's *own* authority — so they can never reach GLA-managed, agent-blind resources — and their host footprint is bounded by an operator allowed-set that defaults permissive for the single-operator profile. The distinction is clean: the launcher author owns the security-bearing **native base** (`runtime_base`) and the **typed options** (`config_schema`); the agent owns **what it mounts from its own filesystem**. Each launcher also declares in its manifest *which* host mounts it can realize (file or directory, `ro`/`rw`); admission validates the agent's mounts against it, so a launcher that cannot share the host — a remote worker — accepts none, and the agent falls back to GLA-mediated transfer.

So adding a runtime backend is: install a `Launcher` plugin → the registry picks it up → assembly, admission, the worker, doctor, and the agent's introspection all work with it immediately. **No special-casing of runtimes** — they extend exactly as channels or auth providers do.

The agent reaches the native layer only in two sanctioned ways: by **authoring a new `Launcher`/template through the contribution workflow** (§8 — reviewed, then trusted), or, in a **trusting deployment profile**, by supplying fuller native overrides validated against a *safety baseline* admission policy (the Pod Security Standards model: `restricted` / `baseline` / `privileged` tiers). By default — strict or multi-tenant profile — the agent only parameterizes a trusted template.

---

## 8. How a third party adds a capability (the contribution workflow)

This is how an operator "extends the app himself":

1. **Author** the provider package — code + the catalog entity (manifest) + skills + contract tests + docs (inseparable; a PR missing skills or contract tests fails review).
2. **Install** — the operator (typically via their agent + `wpm`) stands up the required host dependencies, places the provider's skills, and writes the `DependencyBinding`.
3. **Ingest** — the core validates the manifest, registers the code with its family registry, runs the contract test + probe, registers the skills, and indexes it (§4).
4. **Available** — the provider now appears in the registry by capability and is usable everywhere registry-driven (§5).
5. **Consume** — at runtime the untrusted agent discovers and uses it; it never had to register it.

Contract tests verify code-to-manifest conformance; skill review verifies an agent can use the provider *from its skills alone*. Both are what make an installed provider trustworthy.

---

## 9. First-class now vs deferred

Make the **pattern** first-class now, because it is cheap and high-leverage and mostly already implied by the Catalog and the plugin packaging:

- the self-describing manifest **contract**;
- the generic **ingester**;
- the shared **registry read interface**;
- **capability-based discovery**.

**Defer the heavy machinery** until there are genuinely ≥2 real providers in a family asking for it (the rule already in the architecture): a formal plugin ABI, dynamic hot-loading, a public marketplace/registry, sophisticated version resolution. "Very extendable" is delivered by a clean, uniform *contract* every provider conforms to — not by a framework built up front.

---

## 10. Invariants

- The core never hard-codes a provider list; **all** provider knowledge flows through the registry.
- Providers are **trusted code the operator installed**; the runtime agent consumes the registry and never registers into it.
- Every provider ships **skills** and a **contract/health probe**; a provider that can't be probed or whose contract fails cannot be marked `available`.
- Availability is **system-derived**, never author-declared.
- The **capsule runtime extends by the same mechanism** as every other family — a `Launcher` is just another self-registering provider.

---

## Provenance

**Grounded in the source docs:** the Catalog (Store / Ingester / Index), the plugin-package shape (code + entity + skills + docs + contract tests), `DependencyBinding`, the five ownership modes, the Spawner Registry and JupyterHub pattern, the pluggable kinds, "every plugin ships its own skills," and "defer the plugin API until ≥2 providers per family."

**Synthesized / sharpened here:** the explicit inversion-of-control framing, the *single uniform manifest contract across all families*, the install-time-trusted vs runtime-untrusted **two clocks** as the precise meaning of self-registration, the native-bottom/thin-top split living in the `Launcher` manifest, the capsule-runtime-as-instance unification, the Pod-Security-style profile tiers for native overrides, and the **typed `config_schema` vocabulary** (§3.1) — which borrows Terraform's provider-schema model (the schema as the validated *contract*, checked offline), the *generate-then-dry-run* loop from `kubectl`'s imperative commands, and from Firecracker both the declare-a-schema-once (rather than hand-author a command per option) lesson and the single-document/sequence equivalence. The per-launcher **mount capability** — which host mounts a runtime can realize, with the host-share fallback to GLA-mediated transfer — is synthesized here too.

## Related

`01-architecture-overview.md` (the `wpm` boundary and dependency-ownership modes), `04-capsule-assembly.md` (how the agent composes a spec against these `config_schema`s), `components/catalog.md` (the registry), `components/worker-plane.md` (the Spawner Registry), `components/capsule.md` (what a `Launcher` runs), `components/admission-and-policy.md` (validates against the registry), `05-cli-and-entities.md` (the `catalog` / `template` / `skill` / `schema` read commands), `03-software-candidates.md` (the concrete software filling each pluggable layer).
