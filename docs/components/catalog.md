# Catalog

**Zone:** Config
**Kind:** GLA component (traditional code)
**Scenario-01 lane:** *implicit — served via the Bridge (Phase 1) and checked in Admission (Phase 2)*

> The system's typed configuration model: what is installable, what is currently available, and the skills and code each plugin ships — all as git-tracked, Backstage/Kubernetes-shape entities.

## Role

The Catalog is the single typed model of everything operators author and everything plugins ship. It holds the entity descriptors, ingests them through a mutate-then-validate pipeline, and exposes a queryable index whose availability status is *system-derived*, not author-declared. It is the source of truth for "what exists and what is usable right now."

## Responsibilities (owns)

- **Store** — a git-tracked filesystem of YAML descriptors, including plugin packages (entity + code + skills + docs + contract tests).
- **Ingester** — a two-phase (mutating then validating) pipeline; resolves cross-references; registers declared skills with the skill manifest and plugin code with the right runtime registry.
- **Index** — a queryable view of ingested entities with current binding state and availability; feeds Admission, the skill manifest, and Setup.

## Interfaces

**Receives** — entity descriptors from the Store; `DependencyBinding` state from the probe/`wpm`.
**Produces** — the available-entities index to Admission; templates/skills to the Bridge; availability to Setup/Doctor.

## What it does NOT do

It makes no run-time decisions and runs nothing. Status is *derived* (from bindings, probes, ingestion), never authored. It does not host plugin code — it registers it with the runtime registries.

## Entities & data

The pluggable kinds (`CapsuleTemplate`, `Launcher`, `HumanEntrypoint`, `AgentConnector`, `Workspace`, `CompletionDetector`, `Sidecar`, `Dependency`, `ChannelAdapter`, auth providers) and operator-authored kinds (`AuthorityProfile`, `PolicyProfile`, `Skill`, `Location`); `DependencyBinding` (consumed for availability).

## In scenario 01

Not a dedicated lane, but present throughout setup of the flow: in Phase 1 the Bridge serves available templates + the skill manifest *from* the Catalog; in Phase 2 Admission validates the proposal against catalog *availability*.

## Failure modes

A descriptor that fails validation is rejected at ingest (it never reaches the index). A dependency whose binding probe fails shows as unavailable, so Admission will reject proposals that need it.

## Invariants

Status is system-derived, never author-declared. Entities follow the shared apiVersion/kind/metadata/spec/relations shape. Every pluggable kind ships skills. The index, not the directory, is the source of "what's available" (an unlisted entity is inert).

## Related

`admission-and-policy.md` (consumes the index), `agent-bridge.md` (serves templates/skills), the `work-package-manager` integration (writes the `DependencyBinding`s that drive availability — overview §8), `../02-provider-and-extension-model.md` (the inversion-of-control extension model this registry implements).
