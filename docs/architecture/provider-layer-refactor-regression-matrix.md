# Provider Layer Refactor Regression Matrix

This matrix is the GLA-110.13 verification contract for the provider-layer refactor. It ties the target
model to executable evidence across app composition, catalog projection, CLI diagnostics, gateway asset
handling, and documentation.

## Scenario Matrix

| Scenario | Refactored path under test | Concrete verification evidence |
|---|---|---|
| Reference local-dev | Reference app boots from `ProviderRegistry`, `AppDeploymentConfig`, and capsule defaults for `local-dev`; no central `AppProviderSet` discovery is required. Expected ids: `webauthn`, `channel-cli`, `secret-store-reference`, `launcher-process`, `workspace-profile`, `entrypoint-novnc`, `connector-cdp`, `user-done`. | `packages/app/test/integration/provider-registry-composition.test.ts` test `verifies registry, deployment, capsule, catalog, admission, provisioning, and gateway asset evidence agree` verifies selected ids, default sources, catalog provenance, dry-run `ResolvedCapsulePlan`, gateway asset evidence, and `authModule`. |
| Single-operator | Installed inventory projects app deployment defaults, capsule defaults, dependency evidence, and client assets for a single operator host. Expected inventory defaults include `webauthn`, `channel-cli`, `secret-store-reference`, `launcher-process`, `entrypoint-novnc`, `connector-cdp`, `workspace-profile`, and `url-watcher`. | `packages/catalog/test/unit/provider-install-update.test.ts` test `previews registry, deployment, capsule, compatibility, and evidence changes before activation` verifies the `single-operator` inventory, doctor report, dependency evidence, and package asset readiness; `surfaces/cli/test/integration/cli.test.ts` verifies `gla provider-install plan/apply/rollback` and `gla doctor provider-graph`. |
| Delegated-auth | Auth selection is deployment configuration, not capsule assembly; delegated providers flow through the same graph and diagnostics as WebAuthn. Expected auth id: `authentik`; expected capsule ids remain `launcher-process`, `workspace-profile`, `entrypoint-novnc`, `connector-cdp`, `url-watcher`. | `packages/app/test/integration/provider-registry-composition.test.ts` test `projects delegated auth from AppDeploymentConfig while capsule defaults stay separate` verifies target-path delegated auth through registry, doctor, catalog/admission dry-run, and provisioning wiring; `packages/app/test/e2e/authentik-scenario-e2e.test.ts` verifies delegated auth behavior and fail-closed diagnostics. |
| Custom capsule-provider | A user-authored capsule provider registers into the boot registry, becomes catalog-visible, and can be selected by capsule template/assembly defaults. Expected custom provider id: `launcher-authoring-boot`. | `packages/app/test/integration/provider-registry-composition.test.ts` test `registers a locally authored provider into a development boot context and projects it to catalog` verifies scaffold skeleton, registry entry, template default source, and catalog projection for the authored launcher. |
| Provider install/update | Operator/provider-agent install UX plans, applies, rolls back, and doctors active inventory/provider graph changes before runtime consumption. Expected diagnostics include duplicate, unsigned/unverifiable, dependency-unavailable, compatibility-ambiguous, and client-asset states. | `packages/catalog/test/unit/provider-install-update.test.ts` verifies plan/apply/rollback/doctor behavior; `surfaces/cli/test/integration/cli.test.ts` verifies `gla provider-install plan`, `gla provider-install apply`, `gla provider-install rollback`, and `gla doctor provider-graph` commands. |
| Provider authoring-to-runtime | Authoring UX produces consumed provider/template fields, then runtime composition sees the provider through registry and catalog rather than app-source edits. Expected consumed fields include provider manifests, `template.<id>` defaults, `compatibility.requiredParts`, docs, skills, and tests. | `surfaces/cli/test/integration/cli.test.ts` verifies `gla provider scaffold/validate/test/inspect` and `gla template-package scaffold/validate/test/inspect`; `packages/app/test/integration/provider-registry-composition.test.ts` verifies authored provider registration and runtime catalog visibility. |

## Cross-Layer Evidence

| Layer or responsibility | Evidence |
|---|---|
| Registry population | `provider-registry-composition.test.ts` verifies sealed `ProviderRegistry` entries, provider ids, versions, factory availability, probe registration, and package evidence. |
| Deployment config resolution | `app-deployment-config.test.ts` and `provider-registry-composition.test.ts` verify `AppDeploymentConfig` selects `AuthProvider`, `ChannelAdapter`, and `SecretStore` without capsule fields. |
| Capsule template/assembly resolution | `provider-registry-composition.test.ts`, `provider-graph-projection.test.ts`, and `cli.test.ts` verify `CapsuleTemplate` defaults, open parts, consumed template defaults, and `AssemblySpec` proposal admission. |
| Catalog projection | `provider-registry-composition.test.ts` and `provider-graph-projection.test.ts` verify provider provenance, selected providers, resolved config, dependency evidence, availability, diagnostics, and skills/docs projection. |
| Admission Resolver | `provider-registry-composition.test.ts` verifies dry-run `sessionCreate` returns an accepted `ResolvedCapsulePlan` from the same graph used by catalog and provisioning. |
| Provisioning | `provider-registry-composition.test.ts` verifies `createProvisioningBridge` builds worker-plane handles from the graph-selected providers without spawning during dry-run; broader provisioning behavior remains covered by `packages/app/test/integration/provision.test.ts`. |
| CLI diagnostics | `cli.test.ts` verifies executable provider authoring, template-package, install/update, doctor, schema, and deferred legacy diagnostics. |
| Gateway asset handling | `provider-registry-composition.test.ts`, `provider-install-update.test.ts`, and `packages/gateway/test/integration/handoff.test.ts` verify entrypoint client asset provenance, missing/mutable diagnostics, and gateway rejection of duplicate, wrong-provider, non-read-only, and local-override asset mounts. |
| Documentation | `provider-layer-refactor-contract-doc.test.ts` verifies this matrix, target architecture docs, UX command docs, and the five-entity model stay aligned. |

## Boundary Checks

The GLA-110.13 boundary checks intentionally allow legacy compatibility code only where GLA-110.07 placed it.
They must fail if new central runtime composition code reintroduces direct provider-set/profile shape reads or
provider-set callback seams outside the compatibility adapter.

| Retired surface | Allowed before GLA-110.14 | Blocking check |
|---|---|---|
| `AppProviderSet.modules`, `providerSet.profiles`, `providerSet.profile`, `providerSet.selectedProfileId` | `packages/app/src/provider-compat.ts` only, plus deprecated alias/export plumbing that calls the adapter. | `provider-registry-composition.test.ts` scans `packages/app/src` for direct shape reads and expects them only in `provider-compat.ts`. |
| `defaultConfig`, `defaultServices`, `entrypointClientAssets`, `templateProbes` provider-set callbacks | `packages/app/src/provider-compat.ts` only. | `provider-registry-composition.test.ts` scans runtime composition source and fails if callback access appears outside the compatibility adapter. |
| Broad `ProviderSelectionProfile` / `ProviderProfileManifest` runtime selection | compatibility migration readers only until GLA-110.14 removes them. | `provider-layer-refactor-contract-doc.test.ts` verifies the target docs mark broad profiles as split/narrowed compatibility surfaces, not target architecture. |
