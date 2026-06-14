# Provider Author Workflow

This is the concrete contribution path for adding a new GLA provider under the internal Provider Host
architecture. It is intentionally not a public plugin ABI or dynamic hot-loading contract. Providers are trusted
install-time code selected by the operator, usually as part of a provider set.

The default and custom provider path is intentionally the same for runtime layers: every user-facing runtime layer
is a provider family, every implementation is a provider package, and selected defaults live in provider profiles.
Capsule templates follow the same package/test discipline as catalog `TemplatePackage`s rather than Provider Host
factories. The provider graph plan in `provider-graph-defaults-and-extension-plan.md` is the architecture source for
that direction. The developer/operator-agent authoring experience for this workflow is specified in
`provider-authoring-ux.md`; that UX spec covers entry points, diagnostics, recovery, and the handoff into operator
install/update.

## Where Provider Code Lives

A provider package owns its adapter code and tests. Today the reference distribution keeps concrete adapters under
`adapters/<family-name>/` and collects the selected in-tree providers in `packages/provider-set-reference`.

The provider set is the approved boundary that imports concrete provider packages and registers them with
`ProviderHost`. Runtime packages such as `packages/app`, `packages/gateway`, `packages/session`,
`packages/identity`, `packages/route`, `packages/completion`, `packages/worker`, and `packages/kernel` must not
import a concrete provider adapter or provider-owned implementation type.

`packages/app/src/composition.ts` is not a provider set. It is the generic composition engine and must receive a
provider set/profile from outside. The in-tree reference build selects `packages/provider-set-reference` only from
`packages/app/src/index.ts`, the explicit default distribution entrypoint. A second distribution follows the same
pattern: create a provider-set package or entrypoint, register trusted modules there, define the selected profile
there, and pass that set into app composition at boot.

## What A Provider Must Ship

Each provider ships these artifacts together:

- A `ProviderManifest` with stable `metadata.name`, `spec.family`, `capability`, `config_schema` or
  `factory_config_schema`, `probe`, `skills`, optional `requires`, and optional `relations.compatibleWith`.
- A factory registered through the matching `ProviderRegistrationContext` method, such as `registerLauncher`,
  `registerAuthProvider`, `registerChannel`, or `registerSecretStore`.
- A probe that proves current health and contract availability. Availability is system-derived from WPM
  dependency bindings plus probes, never author-declared.
- Optional provider-owned state schema. Any state slot that can contain credentials, subjects, attempts, raw
  secrets, or dependency material must be marked sensitive and must stay inside the provider namespace.
- Optional browser-client assets for human-entrypoint providers. The provider set maps provider-owned asset refs to
  read-only gateway asset mounts; gateway code serves generic mounts and does not import provider packages.
- Skills/docs that explain how an agent or operator uses the provider from the registry, without needing hidden
  adapter knowledge.
- Contract tests proving manifest identity, schema validation, dependency behavior, probe behavior, skill
  visibility, runtime creation, redacted diagnostics, and compatibility declarations.

For providers that need non-provider services, such as an identity service for a channel or a test URL reader for a
detector, the selected provider set supplies those service bindings. Generic app composition may pass provider-neutral
services it owns, but it must not know provider-specific service keys beyond the selected provider-set contract.

## What WPM Owns

Host dependencies belong to WPM packages and their install receipts. A provider manifest declares `requires`; WPM
stands up or adopts the dependency and writes `DependencyBinding` evidence. GLA reads that evidence through Catalog
and Provider Host checks. Provider code must not treat the existence of a manifest or package as proof that a
host-touching dependency is usable.

Provider-set selection is an operator/distribution decision. A selected profile names one provider id per runtime
family the app composes (`auth`, `launcher`, `connector`, `workspace`, `entrypoint`, `detector`, and `channel` for
the current reference app). Changing that profile changes boot-time wiring and catalog/template defaults; it must
not require edits to gateway, session, identity, worker, kernel, or generic app composition code.

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
fail if runtime packages import concrete migrated providers outside the approved provider-set boundary. The same
gate rejects imports of the reference provider set from generic runtime paths; only the explicit default
distribution entrypoint may select the reference provider set directly.

## Minimal Provider-Set Checklist

Before a provider set is selectable:

- The provider-set package imports concrete provider packages and exports trusted `GlaProviderModule`s with stable
  `moduleId`s for diagnostics/read models.
- The selected profile names provider ids that are registered by those modules.
- Provider-set default config maps deployment/legacy inputs into provider-owned config records; generic app code does
  not branch on provider ids.
- Provider-set default services map provider-specific service keys, if any; generic app code sees only
  provider-neutral service intent.
- Human-entrypoint asset refs are mapped to read-only static roots by the provider set, not by gateway/session/core.
- Contract tests prove a non-reference provider set can boot, project catalog/read-model output, create runtime
  ports, and fail closed through Provider Host diagnostics.
- No public API lets users, agents, request payloads, or runtime inputs register executable provider code after
  daemon boot.
