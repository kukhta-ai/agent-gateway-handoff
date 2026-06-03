// @gla/mcp — edge ring (baseline §1).
// MCP server over bridge core — parity with cli (placeholder).
// Empty skeleton: exports a trivial marker so the package compiles and the boundary graph is real.
// Real contracts/logic land in later GLA tasks; this file intentionally holds no behaviour.

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const MCP_MODULE = "@gla/mcp" as const;

/** Ring classification from the architecture baseline (informational). */
export const MCP_RING = "edge" as const;
