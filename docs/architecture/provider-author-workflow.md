# Provider Author Workflow

This is the concrete contribution path for adding a new GLA provider under the `ProviderRegistry` target architecture
and the internal Provider Host factory runner. It is intentionally not a public plugin ABI or dynamic hot-loading
contract. Providers are trusted install-time code registered at boot, then selected by app deployment configuration
or capsule template/assembly composition.

The default and custom provider path is intentionally the same for runtime layers: every user-facing runtime layer
is a provider family, every implementation is a provider package, and selected defaults live in app deployment
configuration or capsule template packages. Capsule templates follow the same package/test discipline as catalog
`TemplatePackage`s rather than Provider Host factories. The provider graph plan in
`provider-graph-defaults-and-extension-plan.md` is the architecture source for that direction. The
developer/operator-agent authoring experience for this workflow is specified in `provider-authoring-ux.md`; that UX
spec covers entry points, diagnostics, recovery, and the handoff into operator install/update.

## Where Provider Code Lives

A provider package owns its adapter code and tests. Today the reference distribution keeps concrete adapters under
`adapters/<family-name>/` and exposes the selected in-tree provider modules from the reference distribution package.

ProviderRegistry bootstrapping is the approved boundary that imports concrete provider packages and may use internal
`ProviderHost` mechanics to register factories. Runtime packages such as `packages/app`, `packages/gateway`,
`packages/session`,
`packages/identity`, `packages/route`, `packages/completion`, `packages/worker`, and `packages/kernel` must not
import a concrete provider adapter or provider-owned implementation type.

`packages/app/src/composition.ts` is not a provider registry author. It is the generic composition engine and must
receive a `ProviderRegistry`, `AppDeploymentConfig`, and capsule template/assembly defaults from outside. The
in-tree reference build selects its reference distribution only from the explicit default entrypoint. A second
distribution follows the same pattern: create a provider package or distribution entrypoint, register trusted
modules there, define app deployment defaults and capsule template defaults there, and pass those inputs into app
composition at boot.

## What A Provider Must Ship

Each provider ships these artifacts together:

- A `ProviderManifest` with stable `metadata.name`, `spec.family`, `capability`, `config_schema` or
  `factory_config_schema`, `probe`, `skills`, optional `requires`, and optional `relations.compatibleWith`.
- A factory registered through the matching internal `ProviderRegistrationContext` method, such as
  `registerLauncher`, `registerAuthProvider`, `registerChannel`, or `registerSecretStore`.
- A probe that proves current health and contract availability. Availability is system-derived from WPM
  dependency bindings plus probes, never author-declared.
- Optional provider-owned state schema. Any state slot that can contain credentials, subjects, attempts, raw
  secrets, or dependency material must be marked sensitive and must stay inside the provider namespace.
- Optional browser-client assets for human-entrypoint providers. Provider-owned asset refs are projected into catalog
  provenance and read-only gateway asset mounts; gateway code serves generic mounts and does not import provider
  packages.
- Skills/docs that explain how an agent or operator uses the provider from the registry, without needing hidden
  adapter knowledge.
- Contract tests proving manifest identity, schema validation, dependency behavior, probe behavior, skill
  visibility, runtime creation, redacted diagnostics, and compatibility declarations.

For providers that need non-provider services, such as an identity service for a channel or a test URL reader for a
detector, the selected deployment or capsule configuration supplies those service bindings. Generic app composition
may pass provider-neutral services it owns, but it must not know provider-specific service keys beyond the selected
provider package contract.

## Authoring Validation Surface

Provider and template authoring is a developer/operator-agent UX, separate from operator install/update and runtime
catalog consumption. The catalog package exposes pure authoring helpers for that UX:

- `createProviderPackageSkeleton` and `validateProviderPackageAuthoring` produce or validate provider package
  manifests, module registration evidence, probe evidence, skills/docs, contract-test refs, dependency declarations,
  WPM skeleton requirements, and narrow-waist file boundaries.
- `createTemplatePackageSkeleton` and `validateTemplatePackageAuthoring` produce or validate `TemplatePackage`
  manifests, catalog `CapsuleTemplate` entries, schemas, defaults, compatibility declarations, skills/docs, and
  template-level dependencies.

These reports use stable diagnostic codes and redact secret-shaped values. A successful authoring report is not an
availability claim: it reports `availability: "not-evaluated"` and hands the package to the operator install/update
UX, where WPM receipts, deployment/template selection, and restart validation are handled. Runtime consumption then reads the
resolved catalog/provider graph after install and boot probes have produced current evidence.

## What WPM Owns

Host dependencies belong to WPM packages and their install receipts. A provider manifest declares `requires`; WPM
stands up or adopts the dependency and writes `DependencyBinding` evidence. GLA reads that evidence through Catalog
and ProviderRegistry/internal factory checks. Provider code must not treat the existence of a manifest or package as proof that a
host-touching dependency is usable.

Provider selection is an operator/distribution decision. App deployment configuration names app-infrastructure
providers such as `auth`, `channel`, and `secret-store`; capsule templates and assembly specs name capsule providers
such as `launcher`, `connector`, `workspace`, `entrypoint`, and `detector`. Changing those selections changes
boot-time wiring and catalog/template defaults; it must not require edits to gateway, session, identity, worker,
kernel, or generic app composition code.

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

The implementation checkpoint is `pnpm gate`: it includes provider-layer contract tests and boundary checks that
fail if runtime packages import concrete migrated providers outside the approved registry/bootstrap boundary. The
same gate rejects imports of the reference distribution from generic runtime paths; only the explicit default
distribution entrypoint may select the reference provider modules directly.

## Minimal Provider Package Checklist

Before a provider package or distribution bootstrap is selectable:

- The package imports concrete provider adapters and exports trusted `GlaProviderModule`s with stable
  `moduleId`s for diagnostics/read models.
- App deployment config or capsule template defaults name provider ids that are registered by those modules.
- Provider-owned config defaults map deployment/template intent into provider-owned config records; generic app code
  does not branch on provider ids.
- Provider-specific service keys, if any, stay inside provider package contracts; generic app code sees only
  provider-neutral service intent.
- Human-entrypoint asset refs are mapped to read-only static roots through catalog/gateway provenance, not by
  gateway/session/core importing provider packages.
- Contract tests prove a non-reference provider can register, project catalog/read-model output, create runtime
  ports, and fail closed through registry/factory diagnostics.
- No public API lets users, agents, request payloads, or runtime inputs register executable provider code after
  daemon boot.
