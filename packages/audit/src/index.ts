// @gla/audit — core ring (baseline §1).
// Append-only trail, indexed by task, egress-redacted.

import { redactOperatorEgress } from "@gla/kernel";

/** Stable identifier for this module, used only to prove the package builds and is importable. */
export const AUDIT_MODULE = "@gla/audit" as const;

/** Ring classification from the architecture baseline (informational). */
export const AUDIT_RING = "core" as const;

/** Structured audit event shape accepted at the package egress seam. */
export type AuditEgressRecord = Record<string, unknown>;

/**
 * Redact an audit event before it leaves the daemon boundary for operator-visible storage, export, or diagnostics.
 * The append-only writer can still keep structured non-sensitive context; bearer URLs and raw credential values are
 * removed at this explicit egress seam.
 */
export function redactAuditEgress(event: unknown): unknown {
  return redactOperatorEgress(event);
}

/** Serialize a redacted audit event as one JSON line for sinks that use line-oriented export. */
export function auditEgressJson(event: unknown): string {
  return `${JSON.stringify(redactAuditEgress(event))}\n`;
}
