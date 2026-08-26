// @gla/connector-cdp — adapter ring (baseline §1, docs/03 §7, GLA-024/025, GLA-040/041).
// AgentConnector: CDP (Chrome DevTools Protocol), TUNNELLED THROUGH GLA. Implements the kernel `AgentConnectorPort`:
//   attach(runtime) → { type:"cdp", cdp_url, secret_ref }
//
// The `cdp_url` points at a GLA-side CDP BROKER (`cdp-broker.ts`), NOT directly at Chromium. The broker is a tiny
// local forwarder (the same `node:net` raw-pipe pattern the Access Gateway's WS proxy uses) that forwards the agent's
// CDP requests/upgrades to Chromium's real `ws://127.0.0.1:<cdpPort>/...` and tracks every live socket per capsule.
// This is what makes agent-blind REAL: a recipient-bound window can TRULY SEVER the agent's already-open CDP socket
// the instant it opens (not merely refuse a fresh attach) — it resolves the docs/05 §7 "connector brokering" open
// question in favour of TUNNELLING, which is what S-2 requires.
//
// AGENT-BLIND (the load-bearing GLA-024/025 AC#1/#2, GLA-040/041): `secret_ref` is a **capability reference** minted
// by the CapabilityService (a `secret-ref`-class ref, agent-blind) — NEVER a raw secret or signing material. The
// session saga mints the connector capability and binds its `secret_ref` here. And while a window is open the agent's
// CDP is SEVERED at the broker: the agent has no live channel onto the capsule while the human enters a secret.
//
// Boundary (adapter ring): depends ONLY on @gla/kernel + Node builtins (via cdp-broker.ts) — it reads the CDP url off
// the runtime handle via the kernel's neutral `decodeRuntimeHandle` codec (NOT by importing the launcher adapter; the
// boundary lint forbids adapter→adapter). It is injected at `app`; core never imports it.

import {
  type AgentConnector,
  type AgentConnectorPort,
  type Ref,
  type RuntimeHandle,
  decodeRuntimeHandle,
  glaError,
  runtimeEndpoint,
} from "@gla/kernel";
import { CdpBroker } from "./cdp-broker.js";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const CONNECTOR_CDP_MODULE = "@gla/connector-cdp" as const;
/** Ring classification from the architecture baseline (informational). */
export const CONNECTOR_CDP_RING = "adapter" as const;

/**
 * A resolver the session saga supplies so `attach` can stamp the **agent-blind `secret_ref`** the
 * CapabilityService minted for this capsule (keyed by the provider-neutral connector resource id). When no ref is
 * registered, `attach` still returns the brokered url with the
 * `secret_ref` omitted (the agent can drive; the ref is added once minted) — but the normal provision path registers
 * one first.
 */
export type SecretRefResolver = (resourceId: string) => Ref<"secret-ref"> | undefined;

/** Options for {@link ConnectorCdpAdapter}. */
export interface ConnectorCdpOptions {
  /** Resolve the agent-blind `secret_ref` for a capsule by its connector resource id (set by the session saga). */
  secretRefFor?: SecretRefResolver;
  /** The GLA-side CDP broker to tunnel through (defaults to a fresh broker started lazily on first `attach`). */
  broker?: CdpBroker;
}

/**
 * The CDP Agent-Connector adapter (docs/03 §7). `attach` reads the raw CDP `webSocketDebuggerUrl` from the runtime
 * handle, REGISTERS it with the GLA-side CDP broker, and returns `{type:"cdp", cdp_url, secret_ref}` where `cdp_url`
 * is the BROKERED url (the agent connects through GLA, never directly to Chromium). The `secret_ref` is an
 * agent-blind capability reference; it is never a raw secret. A handle with no CDP url is a `state.no_live_capsule`.
 *
 * Suspend/resume of a window (the S-2 agent-blind severance) are delegated to the broker: `suspendByCdpUrl` DESTROYS
 * the agent's live socket the instant a window opens; `resumeByCdpUrl` re-allows the agent to re-attach onto the SAME
 * brokered `cdp_url` after the window closes.
 */
export class ConnectorCdpAdapter implements AgentConnectorPort {
  private secretRefFor: SecretRefResolver;
  /** The GLA-side CDP broker the agent's CDP is tunnelled through (so a window can sever the live socket). */
  private readonly broker: CdpBroker;
  /** Whether the broker has been started (lazily on first `attach`). */
  private brokerStarted = false;
  /** A registry so the session saga can bind a freshly-minted secret_ref to a connector resource id. */
  private readonly bound = new Map<string, Ref<"secret-ref">>();
  /** Map a connector resource id → its broker capsule key, so suspend/resume resolve it. */
  private readonly resourceToKey = new Map<string, string>();
  /** Adapter-local compatibility map for callers that still probe by the brokered public url. */
  private readonly brokeredToKey = new Map<string, string>();

  constructor(opts: ConnectorCdpOptions = {}) {
    this.secretRefFor = opts.secretRefFor ?? ((url) => this.bound.get(url));
    this.broker = opts.broker ?? new CdpBroker();
  }

  /** The broker this connector tunnels through (so a caller/test can observe live-socket counts / suspend state). */
  get cdpBroker(): CdpBroker {
    return this.broker;
  }

  /**
   * SUSPEND the agent connector for a capsule by its brokered CDP url (the `cdp_url` the agent holds) — the S-2
   * agent-blind SEVERANCE (GLA-040/041). The broker DESTROYS the agent's live socket THIS INSTANT and blocks new
   * connections, so the agent has NO channel onto the capsule while a recipient-bound window is open. Idempotent; a
   * no-op for an unknown url.
   */
  suspendByCdpUrl(cdpUrl: string): void {
    const key = this.brokeredToKey.get(cdpUrl) ?? cdpUrl;
    this.broker.suspend(key);
  }

  /** SUSPEND by provider-neutral connector resource id. */
  suspendByResourceId(resourceId: string): void {
    const key = this.resourceToKey.get(resourceId) ?? resourceId;
    this.broker.suspend(key);
  }

  /** RESUME the agent connector by its brokered CDP url — the window closed; the agent re-attaches onto the SAME url. */
  resumeByCdpUrl(cdpUrl: string): void {
    const key = this.brokeredToKey.get(cdpUrl) ?? cdpUrl;
    this.broker.resume(key);
  }

  /** RESUME by provider-neutral connector resource id. */
  resumeByResourceId(resourceId: string): void {
    const key = this.resourceToKey.get(resourceId) ?? resourceId;
    this.broker.resume(key);
  }

  /** Is this capsule's connector currently suspended (a window is open)? (For observability / the agent-blind test.) */
  isSuspended(cdpUrl: string): boolean {
    const key = this.brokeredToKey.get(cdpUrl) ?? cdpUrl;
    return this.broker.isSuspended(key);
  }

  /** The number of live agent↔broker sockets for a capsule's brokered url (0 after a window-open severance). */
  liveSocketCount(cdpUrl: string): number {
    const key = this.brokeredToKey.get(cdpUrl) ?? cdpUrl;
    return this.broker.liveSocketCount(key);
  }

  /**
   * Bind a minted agent-blind `secret_ref` to a capsule (by connector resource id), so the next `attach` stamps it on
   * the connector JSON. Called by the session saga right after `mintConnector`. The ref is a capability reference,
   * never raw signing material.
   */
  bindSecretRef(resourceId: string, secretRef: Ref<"secret-ref">): void {
    this.bound.set(resourceId, secretRef);
  }

  /** Drop a capsule's bound secret_ref (on teardown). Idempotent. Also unregisters it from the broker. */
  unbindSecretRef(resourceId: string): void {
    this.bound.delete(resourceId);
    const key = this.resourceToKey.get(resourceId);
    if (key !== undefined) {
      this.broker.unregister(key);
      this.resourceToKey.delete(resourceId);
      for (const [url, mappedKey] of [...this.brokeredToKey.entries()]) {
        if (mappedKey === key) {
          this.brokeredToKey.delete(url);
        }
      }
    }
  }

  /** Is a secret_ref currently bound for this connector resource? (For teardown-residual assertions.) */
  hasBinding(resourceId: string): boolean {
    return this.bound.has(resourceId);
  }

  /** Stop the broker (idempotent) — severs every live socket + closes the broker server. For shutdown/teardown. */
  async close(): Promise<void> {
    await this.broker.close();
    this.brokerStarted = false;
  }

  /**
   * Attach the agent connector to a live capsule (kernel `AgentConnectorPort.attach`). Reads the real CDP url off the
   * runtime, registers it with the GLA-side broker, and returns `{type:"cdp", cdp_url, secret_ref}` where `cdp_url` is
   * the BROKERED url (the agent connects through GLA, never directly to Chromium). Throws `state.no_live_capsule` if
   * the runtime carries no CDP endpoint.
   *
   * Note: a SUSPENDED capsule (a window is open) does NOT throw here — `attach` returns the (stable) brokered url, but
   * the BROKER refuses the actual connection/upgrade (and has already severed the live socket), so an agent that
   * re-reads the connector still cannot reach the capsule. The severance is enforced at the BROKER (a live socket is
   * destroyed), not by withholding a url.
   */
  async attach(handle: RuntimeHandle): Promise<AgentConnector> {
    const runtime = decodeRuntimeHandle(handle);
    const endpoint = runtimeEndpoint(runtime, {
      family: "agent-connector",
      provider: "cdp",
      transport: "websocket",
    });
    const realCdpUrl = typeof endpoint?.address === "string" ? endpoint.address : "";
    if (endpoint === undefined || realCdpUrl.length === 0) {
      throw glaError("state.no_live_capsule", "no live capsule with a CDP endpoint to attach", {});
    }
    await this.ensureBroker();
    // Register the capsule with the broker (keyed by its real CDP url — stable + unique) and get the brokered url the
    // agent connects to. Idempotent: a re-attach of the same capsule returns the same brokered url.
    const resourceId = endpoint.resourceId;
    const brokered = this.broker.register(resourceId, realCdpUrl);
    this.resourceToKey.set(resourceId, resourceId);
    this.brokeredToKey.set(brokered.brokeredCdpUrl, resourceId);

    const connector: AgentConnector = {
      type: "cdp",
      resourceId,
      provider: "cdp",
      cdp_url: brokered.brokeredCdpUrl,
    };
    const secretRef = this.secretRefFor(resourceId);
    if (secretRef !== undefined) {
      // The agent-blind reference — a capability ref, NEVER a raw secret/signing key.
      connector.secret_ref = secretRef;
    }
    return connector;
  }

  /** Start the broker once (lazily) so a never-attached adapter binds no port. */
  private async ensureBroker(): Promise<void> {
    if (!this.brokerStarted) {
      await this.broker.listen();
      this.brokerStarted = true;
    }
  }
}

export { CdpBroker };
export type { AgentConnector, AgentConnectorPort, Ref, RuntimeHandle };
