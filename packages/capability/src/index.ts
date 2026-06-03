// @gla/capability — core ring (baseline §1).
// A thin CapabilityService over the kernel's signing-independent CapabilityPort. It does NOT
// reimplement signing, the caveat algebra, or verification — those are the kernel (GLA-004,
// kernel-contracts.md §2). This package adds the *service-level* operations the Agent Bridge needs
// for scenario-01 Phases 0–1:
//   - mintAgentAuthority(profile) — the root `agent-authority` anchor carrying an `allowed-ops`
//     caveat from a local single-operator AuthorityProfile (baseline §5: agent auth deferred, the
//     Bridge still anchors the authority).
//   - whoami(token) — resolve identity + authority profile + allowed ops by VERIFYING the token
//     (never trusting unsigned fields); a tampered/forged token is rejected (GLA-014 AC#3).
//   - revoke(id) — revoke a capability (cascades to descendants by lineage in the kernel).
// The service holds the revocation snapshot and is constructed with any CapabilityPort, so the
// HMAC reference signer or a later macaroon adapter both work unchanged.

import {
  type Capability,
  type CapabilityId,
  type CapabilityPort,
  type Caveat,
  HmacCapabilitySigner,
  type Iso8601,
  type OpaqueToken,
  type Ref,
  type RevocationSnapshot,
  glaError,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const CAPABILITY_MODULE = "@gla/capability" as const;
/** Ring classification from the architecture baseline (informational). */
export const CAPABILITY_RING = "core" as const;

/**
 * A local single-operator AuthorityProfile (baseline §5). It names the matched profile and the
 * exact operation set the agent-authority anchor allows. In the reference profile the operator,
 * the agent-owner, and the recipient may be one person; the profile is the trusted declaration of
 * what the one agent may do — carried into the anchor as the signed `allowed-ops` caveat.
 */
export interface AuthorityProfile {
  /** The profile name, surfaced via the anchor's `authority-profile` caveat and `whoami`. */
  profile: string;
  /** A stable identity for the agent principal (local profile: a fixed local id). */
  identity: string;
  /** The operation set this authority allows — the `allowed-ops` caveat (docs/05 §2 `whoami`). */
  allowedOps: string[];
}

/** The result of `whoami` (docs/05 §2; GLA-017 AC#1): identity + matched profile + allowed ops. */
export interface WhoamiResult {
  /** The agent's stable identity (resolved from the verified anchor's caveats). */
  identity: string;
  /** The matched AuthorityProfile name. */
  authority_profile: string;
  /** The operations this authority allows. */
  allowed_ops: string[];
}

/** What `mintAgentAuthority` hands back: the kernel capability + its bearer token. */
export interface MintedAuthority {
  capability: Capability;
  /** The opaque bearer token — the agent receives this reference, never raw signing material. */
  token: OpaqueToken;
}

/**
 * What `mintConnector` hands back (GLA-024/025): the minted agent-connector capability + the
 * **agent-blind `secret_ref`** the connector JSON carries. The `secretRef` is the capability's id as
 * an opaque {@link Ref}<"secret-ref"> — a capability REFERENCE the agent passes around but cannot
 * inspect or forge; it is **never** the bearer token bytes and **never** raw signing material
 * (kernel-contracts.md §2.3, baseline §4). The bearer `token` stays GLA-side (the agent never receives
 * it); only the `secretRef` is surfaced to the agent.
 */
export interface MintedConnector {
  capability: Capability;
  /** GLA-side bearer token (NOT handed to the agent) — held to revoke/cascade on teardown. */
  token: OpaqueToken;
  /** The agent-blind capability reference the connector JSON's `secret_ref` carries. */
  secretRef: Ref<"secret-ref">;
}

/**
 * Pull the single caveat of a kind out of a verified capability's caveat set, or undefined.
 * Used to read identity/profile/ops back from the *signed* chain — never from unsigned token bytes.
 */
function caveatOfKind<K extends Caveat["kind"]>(
  caveats: readonly Caveat[],
  kind: K,
): Extract<Caveat, { kind: K }> | undefined {
  return caveats.find((c): c is Extract<Caveat, { kind: K }> => c.kind === kind);
}

/**
 * The Capability service (component: capability-service.md). Constructed over a kernel
 * {@link CapabilityPort} (default: the reference {@link HmacCapabilitySigner}), so signing stays an
 * adapter concern. The service is the factory/registrar the Bridge calls to anchor the agent and
 * to resolve `whoami`; it mints what it is asked to and verifies — it makes no policy decision
 * (that is Admission/Cedar) and authenticates no principal (that is Identity+Auth).
 */
export class CapabilityService {
  private readonly port: CapabilityPort;

  /** @param port The kernel capability port; defaults to the reference HMAC signer. */
  constructor(port: CapabilityPort = new HmacCapabilitySigner()) {
    this.port = port;
  }

  /**
   * Mint the root `agent-authority` anchor for a local AuthorityProfile (GLA-014 AC#2). The anchor
   * carries two defining caveats (kernel-contracts.md §2.1): `authority-profile` (the matched
   * profile) and **`allowed-ops`** (the operation set the agent may invoke), plus the agent's
   * identity as an `audience` caveat so it too is signed. It is a ROOT (no parent); every later
   * `task`/`session` capability attenuates from it (child ⊆ parent). The returned `token` is the
   * anchor the agent holds; its authority is the signed caveat chain, so it cannot be forged or
   * widened (GLA-014 AC#3).
   */
  async mintAgentAuthority(profile: AuthorityProfile): Promise<MintedAuthority> {
    const caveats: Caveat[] = [
      { kind: "authority-profile", profile: profile.profile },
      { kind: "allowed-ops", ops: [...profile.allowedOps] },
      // The identity rides as an `audience` caveat so it is part of the signed, tamper-evident
      // chain — `whoami` reads it back via verify(), never from unsigned token bytes.
      { kind: "audience", id: profile.identity },
    ];
    return this.port.mint({ cls: "agent-authority", caveats });
  }

  /**
   * Mint the **agent-connector capability** for a session (GLA-024/025). The connector is an
   * **agent-blind `secret-ref`-class** capability **derived from the session/task capability**: it is
   * minted as a child (`parentRef` = the session/task capability id) so it descends by lineage —
   * revoking the parent (or the connector itself) cascades at the next `verify()`
   * (kernel-contracts.md §2.4). It carries an `audience` caveat naming the session (the connector is
   * bound to exactly that capsule) and a `scope` caveat `"/session/<id>/connector"` (a narrow
   * dimension). The class is `secret-ref` per the kernel taxonomy (§2.1: agent-blind), distinguishing
   * it from the session grant.
   *
   * **Agent-blind (the load-bearing GLA-024/025 AC#1/#2):** the method returns the capability's id as
   * an opaque {@link Ref}<"secret-ref"> (`secretRef`) — a capability REFERENCE — and keeps the bearer
   * `token` GLA-side. The agent receives only the `secretRef`; it never receives the token bytes or any
   * raw signing material. The connector JSON's `secret_ref` is this reference.
   *
   * @param sessionId  the session this connector is bound to (the `audience`)
   * @param parentRef  the session/task capability id the connector descends from (for lineage cascade);
   *                   omit only in a degraded path where no parent capability is available.
   */
  async mintConnector(sessionId: string, parentRef?: CapabilityId): Promise<MintedConnector> {
    const caveats: Caveat[] = [
      // Bound to exactly this session's capsule (the connector is per-capsule, agent-blind).
      { kind: "audience", id: sessionId },
      // A narrow scope dimension — the connector authorizes only the session's connector path.
      { kind: "scope", path: `/session/${sessionId}/connector` },
    ];
    const req: { cls: "secret-ref"; parentRef?: CapabilityId; caveats: Caveat[] } = {
      cls: "secret-ref",
      caveats,
    };
    if (parentRef !== undefined) {
      // Descend from the session/task capability so a lineage revocation cascades to the connector.
      req.parentRef = parentRef;
    }
    const minted = await this.port.mint(req);
    return {
      capability: minted.capability,
      token: minted.token,
      // The agent-blind reference: the capability id as an opaque secret-ref handle. NEVER the token.
      secretRef: minted.capability.id as unknown as Ref<"secret-ref">,
    };
  }

  /**
   * Resolve the agent's identity + authority profile + allowed ops from its anchor token
   * (GLA-017 AC#1). **Verification-first (GLA-014 AC#3):** the token is run through the kernel's
   * stateless `verify()` against the held revocation snapshot; a tampered, forged, or revoked token
   * is rejected with the kernel's typed error (`auth.malformed` / `auth.revoked` / …) — the service
   * NEVER trusts unsigned token fields. On success it reads identity/profile/ops back out of the
   * *verified* capability's caveat set.
   *
   * @param token  the agent-authority anchor (the bearer the agent holds)
   * @param now    the wall-clock instant to evaluate any `ttl` caveat against (defaults to current)
   * @throws GlaErrorException with the kernel's stable code on a rejected token.
   */
  whoami(token: OpaqueToken, now: string = new Date().toISOString()): WhoamiResult {
    const result = this.port.verify(token, {
      now: now as Iso8601,
      revocations: this.port.revocationSnapshot(),
    });
    if (!result.ok) {
      // A forged/tampered/revoked anchor cannot be used to learn identity or ops.
      throw glaError(result.reason, `agent-authority token rejected: ${result.reason}`);
    }
    const cap = result.capability;
    if (cap.cls !== "agent-authority") {
      throw glaError("auth.insufficient", "token is not an agent-authority anchor", {
        detail: { cls: cap.cls },
      });
    }
    const profile = caveatOfKind(cap.caveats, "authority-profile")?.profile;
    const ops = caveatOfKind(cap.caveats, "allowed-ops")?.ops ?? [];
    const identity = caveatOfKind(cap.caveats, "audience")?.id;
    if (profile === undefined || identity === undefined) {
      // A well-formed agent-authority anchor always carries these (mintAgentAuthority adds them);
      // their absence means a malformed authority, not a usable identity.
      throw glaError(
        "auth.insufficient",
        "agent-authority anchor missing identity/profile caveats",
      );
    }
    return { identity, authority_profile: profile, allowed_ops: [...ops] };
  }

  /**
   * Revoke a capability by id (capability-service.md). Delegates to the kernel port, which records
   * the id in the revocation snapshot; by lineage this invalidates the capability AND its
   * descendants at the next `verify()` (kernel-contracts.md §2.4). After this, `whoami` on a
   * revoked anchor throws `auth.revoked`.
   */
  async revoke(id: CapabilityId): Promise<void> {
    await this.port.revoke(id);
  }

  /** The current revocation snapshot to hand to edge verifiers (kernel-contracts.md §2.4). */
  revocationSnapshot(): RevocationSnapshot {
    return this.port.revocationSnapshot();
  }
}
