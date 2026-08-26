# Catalog Dependency Binding Ingest

> **Status:** GLA-082 architecture note. Scope: the runtime seam where GLA reads WPM dependency receipt evidence
> and derives catalog/admission availability. This does not replace the provider model or the WPM install loop.

## Boundary

GLA and WPM meet at a read-only evidence seam:

- **WPM writes** dependency receipts while executing bundle install backlogs (`detect -> setup -> verify -> record`).
- **GLA reads** structured `DependencyBinding` evidence and runs its current runtime probes.
- **GLA never executes** WPM install, repair, uninstall, package-manager, service-manager, or host-mutation steps.

This keeps the project vision intact: deterministic bundle artifacts are pre-authored where possible, while the
installer agent adapts to the actual host and records the facts that cannot be recovered by inspection.

## Static vs Dynamic Data

Provider manifests contain static `DependencyRequirement` entries:

- dependency name, such as `browser-runtime` or `human-view`;
- whether the dependency is host-touching;
- deterministic WPM bundle metadata, such as bundle id/version and declared prerequisites.

Capsule templates may also contain static `DependencyRequirement` entries for infrastructure that is required by
the assembled experience but not owned by a single provider. The reference `browser-handoff` template uses this for
`edge-proxy`: Caddy/nginx/Traefik evidence proves public transport/base-path reachability, while Access Gateway
grant verification, recipient checks, revocation, and auth assurance remain GLA gateway responsibilities.

WPM supplies dynamic `DependencyBinding` entries:

- `source: "wpm-receipt"`;
- ownership mode: managed, local-external, remote-external, manual-byo, or disabled;
- state: installed, adopted, remote, manual, or disabled;
- bundle identity/version and declared requirements;
- typed receipt/task facts;
- connection references;
- last WPM install-time probe;
- inverse operation and decision notes where needed for repair/uninstall safety.

The catalog indexes `IndexedDependencyBinding` diagnostics that combine the static requirement, accepted or
rejected receipt evidence, and the current GLA runtime probe.

## Acceptance Rules

A host-touching dependency is available only when all of these are true:

- a structured WPM receipt binding exists for the dependency;
- the binding source is `wpm-receipt`;
- ownership mode and state are compatible;
- receipt and bundle fields are machine-readable;
- connection facts are references, and secret-bearing facts are `secret-ref` values;
- the last WPM probe is `available`;
- the current GLA runtime probe is `available`.

Missing binding evidence, incomplete machine-readable fields, disabled state, failed last WPM probe, or a degraded
current runtime probe makes the provider not available. Pure in-tree providers with no host-touching dependency
can still be available from their own current probe.

## Diagnostics

Catalog and template details report two separate health questions:

- **Install convergence:** WPM receipt evidence and the last WPM probe.
- **Runtime health now:** the current GLA probe result.

Admission consumes the catalog's derived `available` bit through `toAdmissionCatalog`; it does not reimplement a
second availability rule. For templates, Admission also consumes template-level dependency diagnostics and rejects an
unknown, disabled, or unavailable required provider or missing template-level dependency before a task, session, route,
or capsule is created.
