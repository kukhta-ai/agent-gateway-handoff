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
Template requirements that represent public route transport declare `publicEdge: true`; this asks the catalog to
validate a typed transport descriptor rather than treating generic connection refs as enough.

WPM supplies dynamic `DependencyBinding` entries:

- `source: "wpm-receipt"`;
- ownership mode: managed, local-external, remote-external, manual-byo, or disabled;
- state: installed, adopted, remote, manual, or disabled;
- bundle identity/version and declared requirements;
- typed receipt/task facts;
- connection references;
- public-edge transport evidence where a dependency exposes Access Gateway publicly;
- last WPM install-time probe;
- inverse operation and decision notes where needed for repair/uninstall safety.

The catalog indexes `IndexedDependencyBinding` diagnostics that combine the static requirement, accepted or
rejected receipt evidence, and the current GLA runtime probe. For public-edge requirements, the accepted read model is
`publicEdgeTransport`: public base URL, base path, Access Gateway upstream, route-programming/manual mode, accepted
WPM receipt identity, log-redaction posture, and current reachability evidence.

## Acceptance Rules

A host-touching dependency is available only when all of these are true:

- a structured WPM receipt binding exists for the dependency;
- the binding source is `wpm-receipt`;
- ownership mode and state are compatible;
- receipt and bundle fields are machine-readable;
- connection facts are references, and secret-bearing facts are `secret-ref` values;
- the last WPM probe is `available`;
- the current GLA runtime probe is `available`.

For host-touching requirements, the provider or template must declare a current GLA probe. Omitting `spec.probe`
is only acceptable for non-host-touching in-tree entries; it cannot satisfy runtime health for WPM-backed
dependencies.

For public-edge transport requirements, these are also required:

- public base URL and Access Gateway upstream are URI refs;
- the public base URL path matches the declared base path;
- route mode is either route-programming or manual-route;
- query strings, `Cookie`, `Authorization`, and `Sec-WebSocket-Protocol` are redacted or not logged;
- the current reachability probe is the template's current runtime-health input, not gateway authorization evidence.

At app composition time, provider probes come from ProviderRegistry/internal factory metadata and template probes come
from template descriptors or explicit composition options. A declared provider or template probe that is not
registered fails closed as `unavailable`; WPM receipt evidence alone cannot synthesize current reachability.

Missing binding evidence, incomplete machine-readable fields, disabled state, failed last WPM probe, or a degraded
current runtime probe makes the provider not available. Pure in-tree providers with no host-touching dependency
can still be available from their own current probe.

## Diagnostics

Catalog and template details report two separate health questions:

- **Install convergence:** WPM receipt evidence and the last WPM probe.
- **Runtime health now:** the current GLA probe result.

Provider-graph diagnostics additionally mark whether an unavailable dependency belongs to a provider or to the
template itself. Public-edge transport evidence can make a template dependency available, but it cannot satisfy grant
verification, recipient binding, revocation, enrollment, or auth-assurance requirements.

Admission consumes the catalog's derived `available` bit through `toAdmissionCatalog`; it does not reimplement a
second availability rule. For templates, Admission also consumes template-level dependency diagnostics and rejects an
unknown, disabled, or unavailable required provider or missing template-level dependency before a task, session, route,
or capsule is created.
