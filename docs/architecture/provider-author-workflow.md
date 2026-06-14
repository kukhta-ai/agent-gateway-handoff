# Provider Author Workflow

This is the concrete contribution path for adding a new GLA provider under the internal Provider Host
architecture. It is intentionally not a public plugin ABI or dynamic hot-loading contract. Providers are trusted
install-time code selected by the operator, usually as part of a provider set.

## Where Provider Code Lives

A provider package owns its adapter code and tests. Today the reference distribution keeps concrete adapters under
`adapters/<family-name>/` and collects the selected in-tree providers in `packages/provider-set-reference`.

The provider set is the approved boundary that imports concrete provider packages and registers them with
`ProviderHost`. Runtime packages such as `packages/app`, `packages/gateway`, `packages/session`,
`packages/identity`, `packages/route`, `packages/completion`, `packages/worker`, and `packages/kernel` must not
import a concrete provider adapter or provider-owned implementation type.

## What A Provider Must Ship

Each provider ships these artifacts together:

- A `ProviderManifest` with stable `metadata.name`, `spec.family`, `capability`, `config_schema` or
  `factory_config_schema`, `probe`, `skills`, optional `requires`, and optional `relations.compatibleWith`.
- A factory registered through the matching `ProviderRegistrationContext` method, such as `registerLauncher`,
  `registerAuthProvider`, `registerChannel`, or `registerSecretStore`.
- A probe that proves current health and contract availability. Availability is system-derived from WPM
  dependency bindings plus probes, never author-declared.
- Skills/docs that explain how an agent or operator uses the provider from the registry, without needing hidden
  adapter knowledge.
- Contract tests proving manifest identity, schema validation, dependency behavior, probe behavior, skill
  visibility, runtime creation, redacted diagnostics, and compatibility declarations.

## What WPM Owns

Host dependencies belong to WPM packages and their install receipts. A provider manifest declares `requires`; WPM
stands up or adopts the dependency and writes `DependencyBinding` evidence. GLA reads that evidence through Catalog
and Provider Host checks. Provider code must not treat the existence of a manifest or package as proof that a
host-touching dependency is usable.

## What Must Not Change For A New Provider

Adding a provider must not require edits to the narrow waist:

- Do not add provider-specific imports, enums, config types, or state types to `packages/app`, `packages/gateway`,
  `packages/session`, `packages/identity`, `packages/route`, `packages/completion`, `packages/worker`, or
  `packages/kernel`.
- Do not duplicate provider compatibility tables in app code. Compatibility belongs in provider/template manifests
  and is derived by Catalog.
- Do not leak raw secrets through manifests, dependency bindings, diagnostics, catalog reads, or provider state.
  Secret-bearing values cross seams as `secret:` refs and are resolved only by the selected provider/secret
  resolver.

The implementation checkpoint is `pnpm gate`: it includes Provider Host contract tests and boundary checks that
fail if runtime packages import concrete migrated providers outside the approved provider-set boundary.
