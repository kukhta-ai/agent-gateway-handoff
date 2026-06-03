// @gla/policy-cedar — adapter ring (baseline §1, docs/03 §11, GLA-006).
// The Cedar PolicyPort: the deterministic, **forbid-wins** authorization engine evaluated inside
// admission's validate stage. It implements the kernel `PolicyPort` (kernel-contracts.md §6) WITHOUT
// the kernel — or any core/admission caller — ever naming Cedar (AC#1): core depends on the *shape*
// (`PolicyPort`), `app` injects this adapter (the import-boundary lint proves no core/admission
// package imports `@gla/policy-cedar`).
//
// Engine: the REAL Cedar evaluator via `@cedar-policy/cedar-wasm/nodejs` (an in-tree library, docs/03
// §11 "GLA core, integrated in-tree behind the policy port"). Cedar is itself forbid-wins by
// construction (a matching `forbid` always overrides any `permit`); this adapter additionally treats
// EVERY non-`allow` outcome — a `deny`, an evaluation `failure`, a policy/entity parse error, or any
// thrown error — as `forbid` (fail CLOSED, never fail-open). A policy authoring/load error therefore
// PREVENTS evaluation from yielding `permit` rather than silently allowing.
//
// Swapping the engine (a different Cedar build, or a hand-rolled PARC evaluator) is an internal port
// substitution that changes NO core code (AC#5): the only published surface is `CedarPolicyAdapter
// implements PolicyPort` + a policy-set string.

import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import type {
  Capability,
  ErrorCode,
  PolicyContext,
  PolicyPort,
  ResolvedAssemblySpec,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const POLICY_CEDAR_MODULE = "@gla/policy-cedar" as const;
/** Ring classification from the architecture baseline (informational). */
export const POLICY_CEDAR_RING = "adapter" as const;

/** The Cedar entity-type names this adapter maps the GLA request onto (kept internal to the adapter). */
const PRINCIPAL_TYPE = "Gla::Authority" as const;
const RESOURCE_TYPE = "Gla::Assembly" as const;
const ACTION_TYPE = "Action" as const;

/**
 * A construction error the adapter raises when its policy set cannot be parsed at all (a
 * programming/config error surfaced at wiring time). Distinct from a runtime `forbid`: a malformed
 * policy set is a fail-closed condition the adapter reports loudly rather than silently permitting.
 * `app` (the composition root) decides whether to halt or fall back; either way nothing is ever
 * evaluated to `permit` against an unparsable policy.
 */
export class CedarPolicyLoadError extends Error {
  readonly defects: string[];
  constructor(message: string, defects: string[]) {
    super(message);
    this.name = "CedarPolicyLoadError";
    this.defects = defects;
    Object.setPrototypeOf(this, CedarPolicyLoadError.prototype);
  }
}

/** Options for {@link CedarPolicyAdapter}. */
export interface CedarPolicyAdapterOptions {
  /**
   * The Cedar policy set (human-readable Cedar source). Defaults to {@link MVP_POLICY_SET}, the
   * minimal local-profile policy the scenario needs. The adapter parse-checks it at construction and
   * throws {@link CedarPolicyLoadError} if it is malformed (fail-closed at load).
   */
  policySet?: string;
  /**
   * If `true` (the DEFAULT), a malformed policy set throws at construction. If `false`, the adapter
   * instead enters a permanent **deny-all** mode (every `evaluate` returns `forbid`) — the strongest
   * fail-closed posture for a profile that prefers to keep running over halting. Either way an
   * authoring/load error can NEVER produce a `permit`.
   */
  throwOnLoadError?: boolean;
}

/** Map a determining Cedar policy `id` → the stable GLA reason code the agent branches on. */
function reasonFor(_policyId: string): ErrorCode {
  // The reference policy set denies with `policy.denied`; a richer set can carry more specific codes
  // (e.g. `policy.detector_missing`) via per-policy annotations later. Kept stable here.
  return "policy.denied";
}

/**
 * Build the Cedar `context` record from the GLA `PolicyContext`. Only JSON-scalar values survive into
 * Cedar (its context is `Record<string, CedarValueJson>`); anything else is dropped, so a hostile or
 * oversized context cannot break evaluation (and any throw is still fail-closed → forbid).
 */
function toCedarContext(context: PolicyContext): Record<string, cedar.CedarValueJson> {
  const out: Record<string, cedar.CedarValueJson> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // objects/arrays are intentionally NOT forwarded in the MVP context (kept minimal & safe).
  }
  return out;
}

/**
 * Derive the Cedar resource-entity attributes from a {@link ResolvedAssemblySpec}. These are the
 * facts the minimal policy set decides over: the `template`, the part `use`s, the recipient, and the
 * set of mount modes. All plain JSON, so they cross into Cedar unchanged.
 */
function resourceAttrs(resource: ResolvedAssemblySpec): Record<string, cedar.CedarValueJson> {
  const s = resource.spec;
  const uses: string[] = [];
  const collect = (p?: { use: string }): void => {
    if (p?.use) {
      uses.push(p.use);
    }
  };
  collect(s.launcher);
  collect(s.connector);
  collect(s.workspace);
  for (const e of s.entrypoints ?? []) {
    collect(e);
  }
  for (const d of s.detectors ?? []) {
    collect(d);
  }
  const mountModes = (s.mounts ?? []).map((m) => m.mode ?? "ro");
  return {
    template: s.template,
    recipient: s.recipient,
    uses,
    mount_modes: mountModes,
    has_rw_mount: mountModes.includes("rw"),
  };
}

/**
 * The Cedar {@link PolicyPort} adapter (docs/03 §11). Constructed with a policy set; parse-checks it
 * once at construction (fail-closed: a malformed set throws or arms deny-all). `evaluate` is pure,
 * total, order-independent and **forbid-wins** — the guarantees the PolicyPort contract-test enforces.
 */
export class CedarPolicyAdapter implements PolicyPort {
  private readonly policySet: string;
  /** Set once at construction if the policy set is unparsable AND throwOnLoadError === false. */
  private readonly denyAll: boolean;

  constructor(opts: CedarPolicyAdapterOptions = {}) {
    this.policySet = opts.policySet ?? MVP_POLICY_SET;
    const throwOnLoad = opts.throwOnLoadError ?? true;

    // FAIL-CLOSED AT LOAD: parse-check the policy set up front. A malformed policy can never be
    // allowed to evaluate to `permit`.
    const parsed = cedar.checkParsePolicySet({ staticPolicies: this.policySet });
    if (parsed.type !== "success") {
      const defects = parsed.errors.map((e) => e.message);
      if (throwOnLoad) {
        throw new CedarPolicyLoadError(
          `Cedar policy set failed to parse: ${defects.join("; ")}`,
          defects,
        );
      }
      this.denyAll = true;
    } else {
      this.denyAll = false;
    }
  }

  /**
   * Evaluate the proposal against the policy set (kernel-contracts.md §6). Returns
   * `{decision: "permit"|"forbid", reasons}`. **Forbid-wins / fail-closed:** any Cedar `deny`, any
   * evaluation `failure`, a deny-all armed at load, or any thrown error → `forbid`. `permit` is
   * returned ONLY when Cedar conclusively authorizes the request.
   */
  evaluate(req: {
    principal: Capability;
    action: string;
    resource: ResolvedAssemblySpec;
    context: PolicyContext;
  }): { decision: "permit" | "forbid"; reasons: ErrorCode[] } {
    // A policy set that could not be parsed denies everything (fail-closed).
    if (this.denyAll) {
      return { decision: "forbid", reasons: ["policy.denied"] };
    }

    try {
      const answer = cedar.isAuthorized({
        principal: { type: PRINCIPAL_TYPE, id: req.principal.id },
        action: { type: ACTION_TYPE, id: req.action },
        resource: { type: RESOURCE_TYPE, id: "proposal" },
        context: toCedarContext(req.context),
        policies: { staticPolicies: this.policySet },
        entities: [
          {
            uid: { type: RESOURCE_TYPE, id: "proposal" },
            attrs: resourceAttrs(req.resource),
            parents: [],
          },
          { uid: { type: PRINCIPAL_TYPE, id: req.principal.id }, attrs: {}, parents: [] },
        ],
      });

      // A Cedar evaluation `failure` (bad request/entities) is fail-closed → forbid.
      if (answer.type !== "success") {
        return { decision: "forbid", reasons: ["policy.denied"] };
      }

      if (answer.response.decision === "allow") {
        return { decision: "permit", reasons: [] };
      }
      // deny — Cedar already applied forbid-wins; surface the determining policy ids as stable codes.
      const determining = answer.response.diagnostics.reason;
      const reasons: ErrorCode[] =
        determining.length > 0 ? determining.map(reasonFor) : ["policy.denied"];
      // de-dup while preserving order
      return { decision: "forbid", reasons: [...new Set(reasons)] };
    } catch {
      // Any unexpected engine error is fail-closed → forbid (never fail-open).
      return { decision: "forbid", reasons: ["policy.denied"] };
    }
  }
}

/**
 * The **minimal MVP policy set** for the local single-operator profile (baseline §5: "minimal policy
 * set"). Deliberately small and forbid-wins:
 *
 * - **permit** any principal to `admit` any assembly (the local operator's own agent is trusted to
 *   propose) — the base allow.
 * - **forbid** assembling the explicit `denied-template` (a deny example the policy contract-test
 *   exercises: forbid-wins regardless of the permit above).
 * - **forbid** an assembly that mounts a catastrophic path read-write *as a policy matter* — the
 *   catastrophic-denylist seatbelt expressed in Cedar (docs/04 §6; the per-mount allowed-set/denylist
 *   is also enforced structurally by admission, this is the policy backstop).
 *
 * Swapping in a richer operator `PolicyProfile` changes only this string — no core/admission code
 * (AC#5). Cedar source, parsed/validated at adapter construction.
 */
export const MVP_POLICY_SET: string = [
  "// Base allow: the local single-operator agent may admit assemblies (baseline §5 local profile).",
  "permit(",
  "  principal,",
  '  action == Action::"admit",',
  "  resource",
  ");",
  "",
  "// Deny example (forbid-wins): the reserved denied-template is never admissible, regardless of the",
  "// permit above. The PolicyPort contract-test asserts a deny here wins over any permit, in any order.",
  "forbid(",
  "  principal,",
  '  action == Action::"admit",',
  "  resource",
  ")",
  '  when { resource.template == "denied-template" };',
  "",
  "// Catastrophic seatbelt (docs/04 §6): never admit a read-write mount of a catastrophic template.",
  "// Admission also enforces the structural mount denylist; this is the policy backstop.",
  "forbid(",
  "  principal,",
  '  action == Action::"admit",',
  "  resource",
  ")",
  '  when { resource.has_rw_mount && resource.template == "catastrophic-rw" };',
].join("\n");

/**
 * A tiny deny-only policy fragment a test/operator can union into the set to demonstrate that adding
 * a deny rule (a new policy) changes admission's *decision* without changing the port contract or any
 * caller (AC#5/#8). Exported so the contract-test can prove "swapping policy = no core change".
 */
export function denyTemplatePolicy(template: string): string {
  return [
    "forbid(",
    "  principal,",
    '  action == Action::"admit",',
    "  resource",
    ")",
    `  when { resource.template == "${template}" };`,
  ].join("\n");
}
