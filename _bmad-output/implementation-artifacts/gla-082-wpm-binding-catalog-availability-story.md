# GLA-082 Story: Reflect WPM Install Receipts in Catalog Availability

Status: in-progress

## Story

As a GLA operator and runtime agent,
I want catalog availability to reflect WPM dependency binding receipts and current runtime probes,
so that orientation and admission never treat host-touching software as usable before the installer has
actually recorded structured evidence that it is present and healthy.

## Acceptance Criteria

Use backlog task `GLA-082` as the authoritative AC list. The implementation must prove the important cases:

- fresh catalog with no binding source makes `browser-runtime` and `human-view` backed providers unavailable;
- explicit valid WPM receipt bindings make the reference browser-handoff stack available when current probes pass;
- missing/invalid evidence, disabled bindings, failed WPM last probes, and degraded current probes keep providers
  out of available listings;
- template diagnostics expose dependency evidence without exposing literal secrets;
- admission rejects unavailable providers with `catalog.unavailable` and exit 8 before task/session/capsule state
  is created.

## Implementation Plan

- Split static provider dependency requirements from dynamic WPM dependency bindings in `packages/catalog`.
- Add a catalog constructor input for structured binding evidence. Do not read WPM state or mutate host state in
  the catalog package.
- Evaluate host-touching dependency evidence into indexed diagnostics that preserve ownership mode, installed /
  adopted / remote / manual / disabled state, deterministic bundle metadata, receipt metadata, last WPM probe,
  current runtime probe, inverse operation, and decision notes.
- Keep pure in-tree providers available from their own probe when they have no host-touching dependency.
- Add explicit test/development receipt fixtures for flows that intentionally simulate an installed reference
  slice; do not make the default catalog imply that installation happened.
- Update docs to describe the seam and the receipt contract used by runtime catalog ingestion.

## References

- `docs/02-provider-and-extension-model.md` §2, §4, §6, §8, §10
- `docs/architecture/dependency-strategy.md` §1, §2, §5
- `wpm/wip/installer-skills/gla-installer/references/journaling.md`
- `wpm/wip/bundles/browser-runtime/_AGENTS.md`
- `wpm/wip/bundles/human-view/_AGENTS.md`
- `packages/catalog/src/manifests.ts`
- `packages/catalog/src/index.ts`

## Dev Agent Record

BMAD workflow fallback:

- `bmad-create-story` was loaded and customization resolved; persistent worker returned no usable artifact.
- `bmad-create-architecture` was loaded; workflow was interactive and the architect specialist hit usage limit.
- This story is produced from the committed design set and current implementation as the explicit fallback.
