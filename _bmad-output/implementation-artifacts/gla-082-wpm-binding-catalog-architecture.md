# GLA-082 Architecture Note: WPM Binding Evidence to Catalog Availability

Status: active story artifact
Date: 2026-06-13

## BMAD Workflow Evidence

- `bmad-create-story` was loaded and its activation customization resolved. The persistent worker subagent
  returned no usable story artifact for GLA-082, so this file is the documented fallback allowed by `AGENTS.md`
  when a skill cannot run unattended.
- `bmad-create-architecture` was loaded. The workflow is interactive at initialization and the persistent
  architect specialist hit the environment usage limit before producing an artifact. This note is therefore
  driven from the committed design set and the current code.

## Load-Bearing Boundary

This task is a seam correction, not an installer feature.

WPM owns:

- host detection, setup, repair, uninstall, package-manager and service-manager mutation;
- deterministic bundle metadata (`bundle.yml`, declared `requires`, payload/template/file refs, probes);
- agent-adaptive install decisions such as managed vs adopted vs remote/manual/disabled;
- recording the install receipt in Backlog.md task state plus structured notes.

GLA owns:

- read-only ingestion of structured dependency binding evidence;
- current runtime probes through the catalog probe seam;
- catalog and template diagnostics that show install receipt evidence separately from current health;
- admission decisions derived from the same catalog availability.

GLA runtime must not execute WPM tasks or infer availability from conversation memory, prose notes, unchecked
task status, or seeded manifest defaults.

## Model

Provider manifests declare static `DependencyRequirement` objects. A requirement can say that a provider needs
a host-touching dependency such as `browser-runtime` or `human-view`, and can carry deterministic bundle
metadata such as bundle id/version and declared prerequisites.

WPM receipts provide dynamic `DependencyBinding` objects. A binding is accepted only when the required facts are
machine-readable:

- source is a WPM receipt;
- ownership mode is one of managed, local-external, remote-external, manual-byo, or disabled;
- state records installed/adopted/remote/manual/disabled without collapsing those meanings;
- bundle identity/version and declared requirements are present;
- receipt task identity/status is present;
- connection facts are references, with secrets represented only as secret refs;
- last WPM probe is successful for availability;
- inverse operation / decision notes are available where the ownership mode needs repair or uninstall safety.

The indexed catalog stores `IndexedDependencyBinding` diagnostics for each provider part. These diagnostics
separate:

- deterministic bundle evidence;
- WPM receipt evidence and environment decisions;
- the last WPM install-time probe;
- the current GLA runtime probe.

## Availability Rule

For a host-touching dependency:

- no binding source means unavailable and visible as missing evidence;
- invalid or incomplete machine-readable evidence means unavailable;
- disabled means unavailable;
- last WPM probe missing/degraded/unavailable means unavailable;
- current GLA probe degraded or unavailable means not available;
- only valid receipt evidence plus a current available probe yields available.

For a pure in-tree provider with no host dependency, availability can still be derived from its own current
probe without WPM receipt evidence.

Admission must use this same derived `available` bit through `toAdmissionCatalog`; it must not maintain a
second availability rule.
