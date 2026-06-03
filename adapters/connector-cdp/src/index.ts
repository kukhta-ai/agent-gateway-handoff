// @gla/connector-cdp — adapter ring (baseline §1, docs/03 §7, GLA-024/025).
// AgentConnector: CDP (Chrome DevTools Protocol). Implements the kernel `AgentConnectorPort`:
//   attach(runtime) → { type:"cdp", cdp_url, secret_ref }
// The `cdp_url` is the RAW CDP `webSocketDebuggerUrl` the launcher already discovered (read off the
// runtime handle) — the agent's continuously-attached handle to drive the capsule's browser, bound to
// 127.0.0.1. It is the agent's WORK channel (driven with the agent's own CDP client, off-gla — docs/05
// §2), distinct from the human entrypoint.
//
// AGENT-BLIND (the load-bearing GLA-024/025 AC#1/#2): `secret_ref` is a **capability reference** minted
// by the CapabilityService (a `secret-ref`-class ref, agent-blind) — NEVER a raw secret or signing
// material, and never the OPERATOR's secrets. The session saga mints the connector capability and binds
// its `secret_ref` here; the connector lets the agent DRIVE but exposes no signing key. This adapter
// only reads the CDP url from the runtime and stamps the (already-minted) agent-blind ref — it mints
// nothing and holds no secret.
//
// Boundary (adapter ring): depends ONLY on @gla/kernel — it reads the CDP url off the runtime handle
// via the kernel's neutral `decodeRuntimeHandle` codec (NOT by importing the launcher adapter; the
// boundary lint forbids adapter→adapter). It is injected at `app`; core never imports it.

import {
  type AgentConnector,
  type AgentConnectorPort,
  type Ref,
  type RuntimeHandle,
  decodeRuntimeHandle,
  glaError,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const CONNECTOR_CDP_MODULE = "@gla/connector-cdp" as const;
/** Ring classification from the architecture baseline (informational). */
export const CONNECTOR_CDP_RING = "adapter" as const;

/**
 * A resolver the session saga supplies so `attach` can stamp the **agent-blind `secret_ref`** the
 * CapabilityService minted for this capsule (keyed by the capsule's CDP url, the stable per-capsule
 * identity available to `attach`). When no ref is registered, `attach` still returns the CDP url with
 * the `secret_ref` omitted (the agent can drive; the ref is added once minted) — but the normal
 * provision path always registers one first.
 */
export type SecretRefResolver = (cdpUrl: string) => Ref<"secret-ref"> | undefined;

/** Options for {@link ConnectorCdpAdapter}. */
export interface ConnectorCdpOptions {
  /** Resolve the agent-blind `secret_ref` for a capsule by its CDP url (set by the session saga). */
  secretRefFor?: SecretRefResolver;
}

/**
 * The CDP Agent-Connector adapter (docs/03 §7). `attach` reads the raw CDP `webSocketDebuggerUrl` from
 * the runtime handle (the launcher discovered it at spawn) and returns `{type:"cdp", cdp_url,
 * secret_ref}`. The `secret_ref` is an agent-blind capability reference resolved via
 * {@link ConnectorCdpOptions.secretRefFor}; it is never a raw secret. A handle that does not carry a
 * CDP url is a `state.no_live_capsule` (the capsule has no agent connector to attach).
 */
export class ConnectorCdpAdapter implements AgentConnectorPort {
  private secretRefFor: SecretRefResolver;
  /** A registry so the session saga can bind a freshly-minted secret_ref to a capsule's CDP url. */
  private readonly bound = new Map<string, Ref<"secret-ref">>();

  constructor(opts: ConnectorCdpOptions = {}) {
    this.secretRefFor = opts.secretRefFor ?? ((url) => this.bound.get(url));
  }

  /**
   * Bind a minted agent-blind `secret_ref` to a capsule (by its CDP url), so the next `attach` stamps
   * it on the connector JSON. Called by the session saga right after `mintConnector`. The ref is a
   * capability reference, never raw signing material.
   */
  bindSecretRef(cdpUrl: string, secretRef: Ref<"secret-ref">): void {
    this.bound.set(cdpUrl, secretRef);
  }

  /** Drop a capsule's bound secret_ref (on teardown). Idempotent. */
  unbindSecretRef(cdpUrl: string): void {
    this.bound.delete(cdpUrl);
  }

  /** Is a secret_ref currently bound for this capsule's CDP url? (For teardown-residual assertions.) */
  hasBinding(cdpUrl: string): boolean {
    return this.bound.has(cdpUrl);
  }

  /**
   * Attach the agent connector to a live capsule (kernel `AgentConnectorPort.attach`). Returns the raw
   * CDP url + the agent-blind `secret_ref`. The agent drives the browser over `cdp_url` with its own
   * CDP client (off-gla). Throws `state.no_live_capsule` if the runtime carries no CDP endpoint.
   */
  async attach(handle: RuntimeHandle): Promise<AgentConnector> {
    const runtime = decodeRuntimeHandle(handle);
    const cdpUrl = typeof runtime?.cdpWebSocketUrl === "string" ? runtime.cdpWebSocketUrl : "";
    if (cdpUrl.length === 0) {
      throw glaError("state.no_live_capsule", "no live capsule with a CDP endpoint to attach", {});
    }
    const connector: AgentConnector = { type: "cdp", cdp_url: cdpUrl };
    const secretRef = this.secretRefFor(cdpUrl);
    if (secretRef !== undefined) {
      // The agent-blind reference — a capability ref, NEVER a raw secret/signing key.
      connector.secret_ref = secretRef;
    }
    return connector;
  }
}

export type { AgentConnector, AgentConnectorPort, Ref, RuntimeHandle };
