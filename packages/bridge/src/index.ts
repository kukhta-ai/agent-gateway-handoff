// @gla/bridge — edge ring (baseline §1).
// The Agent Bridge core (components/agent-bridge.md): the agent's single door to GLA — a trust
// boundary, a protocol adapter, and a read/delivery surface, holding NO cognition and enforcing
// nothing on its own (it is a thin transport over the control plane). Slice 1 implements the
// orientation read surface (scenario-01 Phase 1) + connect (the agent-authority anchor):
//   connect()         → trigger→admit→anchor: issue the agent-authority anchor (capability svc)
//   whoami()          → identity + allowed ops, by VERIFYING the anchor (never trusting bytes)
//   templateList/Show → the assemblable menu + each part's backing dependency binding status
//   skillList/Show    → procedural knowledge
//   catalogList       → only entities available in this install (system-derived)
// All reads are side-effect-free (GLA-017 AC#4): the Bridge mutates no task/session state.
//
// Boundary: `bridge` is edge — it imports CORE GLA packages (@gla/capability, @gla/catalog) and
// @gla/kernel, NEVER an adapter (the channel/identity adapters are injected at `app`). The
// import-boundary lint proves the core/bridge never names @gla/channel-cli.

import {
  type AuthorityProfile,
  CapabilityService,
  type MintedAuthority,
  type WhoamiResult,
} from "@gla/capability";
import {
  type Availability,
  CatalogService,
  type IndexedEntity,
  type TemplateShowResult,
} from "@gla/catalog";
import { type OpaqueToken, glaError } from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const BRIDGE_MODULE = "@gla/bridge" as const;
/** Ring classification from the architecture baseline (informational). */
export const BRIDGE_RING = "edge" as const;

/**
 * A read-only snapshot of the task/session aggregate stores, so a caller (and a test) can assert
 * that connect + orient **change no task or session state** (GLA-015 AC#3, GLA-017 AC#4). Slice 1
 * has no Task/Session services yet; this is the minimal observable seam — the Bridge holds it but
 * never writes through it on a read path. A later slice injects the real stores.
 */
export interface StateStores {
  /** A stable, comparable snapshot of task+session state (Slice 1: empty/opaque). */
  snapshot(): { tasks: unknown[]; sessions: unknown[] };
}

/** The default no-op state stores — empty task/session state the read surface never mutates. */
export const EMPTY_STATE: StateStores = {
  snapshot: () => ({ tasks: [], sessions: [] }),
};

/** What the agent receives on connect: the anchor token + the operations it allows (GLA-015 AC#2). */
export interface ConnectResult {
  /** The agent-authority anchor (the bearer the agent holds; never raw signing material). */
  token: OpaqueToken;
  /** The agent's identity (from the anchor). */
  identity: string;
  /** The matched AuthorityProfile name. */
  authority_profile: string;
  /** The set of operations the anchor allows (the `allowed-ops` caveat). */
  allowed_ops: string[];
}

/** Construction options for the Agent Bridge. */
export interface AgentBridgeOptions {
  /** The catalog read service (defaults to the in-tree reference-slice catalog). */
  catalog?: CatalogService;
  /** The capability service that mints/verifies the anchor (defaults to a fresh one). */
  capability?: CapabilityService;
  /** The local AuthorityProfile the anchor is minted from (local single-operator default). */
  profile?: AuthorityProfile;
  /** The task/session state stores (read-only here); defaults to empty. */
  state?: StateStores;
}

/** The default local single-operator AuthorityProfile (baseline §5: agent auth deferred). */
export const DEFAULT_LOCAL_PROFILE: AuthorityProfile = {
  profile: "local-single-operator",
  identity: "agent:local",
  allowedOps: [
    "whoami",
    "catalog.list",
    "template.list",
    "template.show",
    "skill.list",
    "skill.show",
    "task.create",
    "session.create",
    "handoff.open",
    "handoff.wait",
    "task.complete",
  ],
};

/**
 * The Agent Bridge core. A thin transport: it anchors the agent (via the capability service) and
 * serves read-models (via the catalog service); it decides nothing and enforces nothing itself
 * (components/agent-bridge.md invariants). In the local profile the agent is not authenticated
 * (baseline §5) — connect anchors the authority with no credential.
 */
export class AgentBridge {
  private readonly catalog: CatalogService;
  private readonly capability: CapabilityService;
  private readonly profile: AuthorityProfile;
  private readonly state: StateStores;

  constructor(opts: AgentBridgeOptions = {}) {
    this.catalog = opts.catalog ?? new CatalogService();
    this.capability = opts.capability ?? new CapabilityService();
    this.profile = opts.profile ?? DEFAULT_LOCAL_PROFILE;
    this.state = opts.state ?? EMPTY_STATE;
  }

  /**
   * Connect the agent (components/agent-bridge.md "trigger → admit → anchor"). In the local profile
   * there is no credential to verify (baseline §5); the Bridge admits the connection and asks the
   * Capability service to mint the `agent-authority` anchor from the matched AuthorityProfile. The
   * agent receives the anchor AND the set of operations it allows (GLA-015 AC#2). Changes no
   * task/session state (AC#3).
   */
  async connect(): Promise<ConnectResult> {
    const minted: MintedAuthority = await this.capability.mintAgentAuthority(this.profile);
    // Resolve back through verify() so what we hand the agent is exactly what a later whoami reads.
    const who = this.capability.whoami(minted.token);
    return {
      token: minted.token,
      identity: who.identity,
      authority_profile: who.authority_profile,
      allowed_ops: who.allowed_ops,
    };
  }

  /**
   * `whoami` (docs/05 §2, GLA-017 AC#1): the agent's identity + the operations its authority allows,
   * resolved by VERIFYING the anchor token (a tampered/forged/revoked token is rejected with the
   * kernel's typed error). Read-only. Returns the JSON the CLI prints.
   */
  whoami(token: OpaqueToken): WhoamiResult {
    return this.capability.whoami(token);
  }

  /** `template list` (docs/05): the assemblable capsule templates from the catalog index. Read-only. */
  templateList(filter?: { available?: boolean }): IndexedEntity[] {
    const f: { kind: string; available?: boolean } =
      filter?.available !== undefined
        ? { kind: "template", available: filter.available }
        : { kind: "template" };
    return this.catalog.list(f);
  }

  /**
   * `template show <id>` (docs/05, GLA-017 AC#2): required parts + each backing dependency's binding
   * status. Throws the kernel `catalog.unknown` (→ exit 5) for an unknown id. Read-only.
   */
  templateShow(id: string): TemplateShowResult {
    return this.catalog.templateShow(id);
  }

  /** `skill list` (docs/05): registered skills, optionally `--for` a template. Read-only. */
  skillList(filter?: { for?: string }): Array<{ id: string; for?: string }> {
    return this.catalog.skillList(filter);
  }

  /** `skill show <id>` (docs/05): the SKILL.md body. Throws `catalog.unknown` (→ exit 5). Read-only. */
  skillShow(id: string): { id: string; for?: string; body: string } {
    return this.catalog.skillShow(id);
  }

  /**
   * `catalog list [--kind --available]` (docs/05, GLA-017 AC#3): entities available in this install,
   * availability SYSTEM-DERIVED (never caller-asserted). Read-only.
   */
  catalogList(filter?: { kind?: string; available?: boolean }): IndexedEntity[] {
    return this.catalog.list(filter);
  }

  /**
   * A point-in-time snapshot of task/session state, so a caller can assert orientation changed
   * nothing (GLA-015 AC#3, GLA-017 AC#4). The Bridge never writes through this on a read path.
   */
  stateSnapshot(): { tasks: unknown[]; sessions: unknown[] } {
    return this.state.snapshot();
  }
}

/** Re-export the kernel error helper so the CLI can build taxonomy errors without re-importing. */
export { glaError };
export type { Availability, IndexedEntity, TemplateShowResult, WhoamiResult };
export type { AuthorityProfile, MintedAuthority } from "@gla/capability";
