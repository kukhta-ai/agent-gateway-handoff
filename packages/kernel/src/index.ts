// @gla/kernel — core ring (baseline §1).
// Pure domain: entities, ports (interfaces), error taxonomy, caveat model. Zero third-party imports.
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const KERNEL_MODULE = "@gla/kernel" as const;

/** Ring classification from the architecture baseline (informational). */
export const KERNEL_RING = "core" as const;
