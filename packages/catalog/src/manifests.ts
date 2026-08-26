// In-tree catalog manifest data (the "Store" content for Slice 1). docs/02 §3 (the uniform
// provider-manifest contract) + docs/03 (the reference-slice software per layer). These are the
// git-tracked descriptors the Ingester ingests; loading them from in-tree data (rather than a YAML
// directory walk) keeps Slice 1 hermetic and dependency-free while preserving the manifest SHAPE,
// so a real Store that reads YAML files plugs in behind the same Ingester later with no API change.
//
// Seeds the browser-handoff CapsuleTemplate + the six provider manifests it requires
// (launcher-process, entrypoint-novnc, connector-cdp, workspace-profile, url-watcher, user-done),
// each with static dependency requirements. Dynamic DependencyBinding receipts are supplied by WPM
// at runtime; manifests must never imply host software is already installed.

import type {
  AuthAssuranceDiagnostic,
  AuthAssuranceLevel,
  AuthAssuranceProfile,
  ConfigSchema,
} from "@gla/kernel";

/** The pluggable provider families (docs/02 §3) this slice seeds. */
export type ProviderFamily =
  | "auth"
  | "launcher"
  | "entrypoint"
  | "connector"
  | "workspace"
  | "detector"
  | "channel"
  | "secret-store"
  | "template";

/** A dependency's binding status, written by `wpm`, read by GLA (docs/02 §6). Drives availability. */
export type BindingStatus = "bound" | "unbound" | "degraded";

/** The five dependency-ownership modes (docs/02 §6). */
export type OwnershipMode =
  | "managed"
  | "local-external"
  | "remote-external"
  | "manual-byo"
  | "disabled";

/** The environment state WPM recorded for one dependency without collapsing ownership semantics. */
export type DependencyState = "installed" | "adopted" | "remote" | "manual" | "disabled";

/** Probe result vocabulary shared by WPM receipt probes and GLA runtime probes. */
export type ProbeResult = "available" | "degraded" | "unavailable";

/** Deterministic bundle metadata authored before host-specific install decisions are made. */
export interface WpmBundleEvidence {
  /** WPM bundle id, e.g. `browser-runtime`. */
  id: string;
  /** WPM bundle version, e.g. `0.1.0`. */
  version: string;
  /** Declared bundle prerequisites from `bundle.yml`. */
  declaredRequires: Record<string, string>;
  /** Delivered payload file references, when the bundle ships files. */
  fileRefs?: string[];
  /** Delivered template references, when the bundle ships templates. */
  templateRefs?: string[];
  /** Delivered installer script references, when applicable. */
  scriptRefs?: string[];
}

/**
 * Static dependency requirement declared by a provider manifest. This is not proof that the
 * dependency is installed; WPM supplies that separately as a {@link DependencyBinding}.
 */
export interface DependencyRequirement {
  /** The dependency name (matches what a `wpm` bundle stands up). */
  dependency: string;
  /** Host-touching requirements require WPM receipt evidence before they can be available. */
  hostTouching?: boolean;
  /** Named connection references the WPM receipt must expose for this dependency to be usable. */
  connectionRefs?: string[];
  /** True when this dependency proves public transport to Access Gateway, not authorization semantics. */
  publicEdge?: boolean;
  /** Deterministic bundle evidence for the dependency, if the dependency is WPM-managed. */
  bundle?: WpmBundleEvidence;
}

/** Provider-neutral proof fields an AuthProvider can emit for assurance enforcement. */
export type AuthProviderAssuranceEvidenceField =
  | "methodResolvable"
  | "userPresent"
  | "userVerified"
  | "recipientBound"
  | "replayResistant";

/**
 * AuthProvider assurance capability declared in provider manifests.
 *
 * This is static read-model metadata: it tells operators and graph/doctor surfaces which provider-neutral
 * assurance policies the provider can satisfy and which common evidence fields are required. Runtime enforcement
 * still uses the actual {@link AuthAssuranceEvidence} returned by the provider for each ceremony.
 */
export interface AuthProviderAssuranceCapability {
  /** Operator-facing policies this provider can satisfy when runtime evidence proves the required facts. */
  supportedPolicies: readonly AuthAssuranceProfile[];
  /** Highest provider-neutral assurance tier this provider can emit. */
  maxLevel: AuthAssuranceLevel;
  /** Evidence fields required before this provider can satisfy phishing-resistant policy. */
  requiredEvidence: readonly AuthProviderAssuranceEvidenceField[];
  /** Safe floor for valid but missing, ambiguous, or provider-specific evidence. */
  degradesTo?: AuthAssuranceLevel;
  /** Redacted diagnostic reasons this provider may emit when evidence degrades or fails. */
  diagnostics?: readonly AuthAssuranceDiagnostic[];
}

/** A reference to a connection fact. Sensitive facts must be secret refs, never literal values. */
export interface DependencyConnectionRef {
  /** The reference kind; `secret-ref` is mandatory for secret-bearing connection facts. */
  kind: "literal" | "secret-ref" | "path-ref" | "uri-ref" | "service-ref" | "socket-ref";
  /** The opaque reference value, or a non-sensitive literal only when `kind` is `literal`. */
  ref: string;
}

/** Machine-readable connection evidence emitted by a WPM dependency receipt. */
export interface DependencyConnectionEvidence {
  /** Named connection references, such as `endpoint`, `chromium`, `clientSecret`, or `socket`. */
  refs: Record<string, DependencyConnectionRef>;
}

/** Public-edge route operation mode recorded by WPM for the edge proxy dependency. */
export type PublicEdgeRouteMode = "route-programming" | "manual-route";

/** Accepted log handling posture for sensitive public-edge carrier fields. */
export type PublicEdgeLogRedactionState = "redacted" | "not-logged";

/** Public-edge log posture for carrier fields that may contain grants or bearer material. */
export interface PublicEdgeLogRedactionPosture {
  queryString: PublicEdgeLogRedactionState;
  cookie: PublicEdgeLogRedactionState;
  authorization: PublicEdgeLogRedactionState;
  secWebSocketProtocol: PublicEdgeLogRedactionState;
}

/** WPM-recorded public-edge transport evidence. It is transport proof, not auth proof. */
export interface PublicEdgeTransportEvidence {
  /** Public base path configured on the edge, e.g. `/` or `/team-a/`. */
  basePath: string;
  /** Whether GLA can program routes or the operator maintains them manually. */
  routeMode: PublicEdgeRouteMode;
  /** Redaction posture for public-edge logs carrying handoff URLs or stream tickets. */
  logRedaction: PublicEdgeLogRedactionPosture;
}

/** Probe evidence captured at a specific point in time. */
export interface DependencyProbeEvidence {
  /** ISO timestamp for the probe, when the producer records one. */
  at?: string;
  /** The probe result. */
  result: ProbeResult;
  /** Optional diagnostic detail safe for logs/catalog output. */
  detail?: string;
}

/** The typed receipt facts WPM maps from Backlog.md task state and structured notes. */
export interface DependencyReceiptEvidence {
  /** WPM install-backlog task id that recorded the receipt. */
  taskId: string;
  /** The task status WPM recorded for the verification step. */
  status: "Done";
  /** When the receipt was recorded, if known. */
  recordedAt?: string;
  /** Files or task refs recorded by WPM. */
  refs?: string[];
  /** Checksums recorded for placed files, keyed by path/ref. */
  checksums?: Record<string, string>;
}

/** Repair/uninstall evidence recorded by WPM for ownership-safe reversal. */
export interface DependencyInverseOperation {
  /** Human-readable description of the inverse operation. */
  description: string;
  /** Optional command reference; callers display it, but GLA never executes it. */
  command?: string;
  /** Condition under which the inverse operation is valid. */
  condition?: string;
}

/** Agent-adaptive install decision recorded by WPM and surfaced separately from bundle metadata. */
export interface DependencyDecisionNote {
  /** The decision, e.g. "adopted existing host chromium". */
  note: string;
  /** Optional rationale/context for repair or audit. */
  rationale?: string;
}

/**
 * Dynamic dependency binding evidence written by WPM and read by GLA. A binding is accepted only
 * when the machine-readable fields required by the dependency contract are present.
 */
export interface DependencyBinding {
  /** The dependency name, matching a provider's {@link DependencyRequirement.dependency}. */
  dependency: string;
  /** Receipt provenance. Free-form prose or seeded defaults are not accepted as this source. */
  source: "wpm-receipt";
  /** Who owns the dependency lifecycle. */
  ownershipMode: OwnershipMode;
  /** The environment state WPM recorded for this dependency. */
  state: DependencyState;
  /** Deterministic bundle metadata from the WPM bundle. */
  bundle: WpmBundleEvidence;
  /** The WPM task/receipt facts proving the install/adoption was recorded. */
  receipt: DependencyReceiptEvidence;
  /** Connection references GLA may use; secrets must be secret refs. */
  connection?: DependencyConnectionEvidence;
  /** Public-edge transport evidence when the dependency exposes Access Gateway publicly. */
  publicEdge?: PublicEdgeTransportEvidence;
  /** Legacy compatibility flag from the earlier binding sketch; structured `state` is authoritative. */
  installed?: boolean;
  /** Last WPM install-time verification probe. */
  lastProbe: DependencyProbeEvidence;
  /** Ownership-safe inverse operation or repair note. GLA displays but never executes it. */
  inverseOp?: DependencyInverseOperation;
  /** Agent-adaptive environment decisions, separate from deterministic bundle metadata. */
  decisionNotes?: DependencyDecisionNote[];
}

/**
 * Indexed dependency diagnostics returned by catalog reads. It combines static requirements,
 * accepted/rejected WPM receipt evidence, and the current GLA runtime probe result.
 */
export interface IndexedDependencyBinding extends DependencyRequirement {
  /** Derived receipt status after structured evidence validation. */
  status: BindingStatus;
  /** Ownership mode from accepted WPM evidence, if present. */
  ownershipMode?: OwnershipMode;
  /** Environment state from accepted WPM evidence, if present. */
  state?: DependencyState;
  /** Sanitized connection references. */
  connection?: DependencyConnectionEvidence;
  /** Accepted public-edge transport descriptor, if this dependency is the selected edge transport. */
  publicEdgeTransport?: PublicEdgeTransportDescriptor;
  /** WPM receipt metadata. */
  receipt?: DependencyReceiptEvidence;
  /** WPM install-time probe evidence. */
  lastProbe?: DependencyProbeEvidence;
  /** Current GLA runtime probe evidence for the provider using this dependency. */
  currentProbe?: DependencyProbeEvidence;
  /** WPM inverse operation evidence, shown for repair/uninstall safety but never executed by GLA. */
  inverseOp?: DependencyInverseOperation;
  /** WPM agent-adaptive decision notes. */
  decisionNotes?: DependencyDecisionNote[];
  /** Machine-readable evidence fields that were absent or invalid. */
  missingEvidence: string[];
  /** Separate install-convergence and current-runtime-health diagnostics. */
  diagnostics: {
    install: ProbeResult;
    runtime: ProbeResult;
  };
}

/** Public-edge transport descriptor projected to catalog, doctor, and graph read models. */
export interface PublicEdgeTransportDescriptor extends PublicEdgeTransportEvidence {
  dependency: string;
  publicBaseUrl: DependencyConnectionRef;
  accessGatewayUpstream: DependencyConnectionRef;
  acceptedReceipt: {
    source: "wpm-receipt";
    bundleId: string;
    bundleVersion: string;
    taskId: string;
    refs?: string[];
  };
  currentReachability: DependencyProbeEvidence;
}

/** A skill a provider/template ships (docs/02 §3). The body is emitted by `gla skill show`. */
export interface SkillManifest {
  id: string;
  /** Which template/provider this skill is "for" (filters `skill list --for`). */
  for?: string;
  /** The SKILL.md body (markdown) — procedural knowledge the agent loads. */
  body: string;
}

/**
 * A provider manifest (docs/02 §3) — the uniform self-describing shape every family follows. Slice
 * 1 carries the fields orientation reads: identity (name/version/family), capability summary, the
 * typed `config_schema` (the agent's option surface), the required dependencies, the
 * probe name (availability seam), relations (compatibility), and shipped skills.
 */
export interface ProviderManifest {
  apiVersion: "gla.dev/v1";
  kind: string; // Launcher | HumanEntrypoint | AgentConnector | Workspace | CompletionDetector | ChannelAdapter
  metadata: { name: string; version: string };
  spec: {
    family: ProviderFamily;
    capability: { summary: string; [k: string]: unknown };
    config_schema?: ConfigSchema;
    /** Static host dependency requirements. Dynamic binding evidence is supplied by WPM receipts. */
    requires?: DependencyRequirement[];
    /**
     * Provider construction config. When absent, Provider Host uses `config_schema`; detector manifests can keep
     * `config_schema` as per-session params while exposing construction-only knobs here.
     */
    factory_config_schema?: ConfigSchema;
    /** The probe name resolved against the Index's probe registry (system-derived availability). */
    probe?: string;
    skills?: SkillManifest[];
    relations?: { compatibleWith?: Record<string, string[]> };
  };
}

/**
 * A CapsuleTemplate manifest (docs/04; the assemblable menu, docs/05 §2). It names the REQUIRED
 * parts (by part-role) and, for each, the provider that backs it — so `template show` can report
 * each backing dependency's binding status (GLA-017 AC#2).
 */
export interface TemplateManifest {
  apiVersion: "gla.dev/v1";
  kind: "CapsuleTemplate";
  metadata: { name: string; version: string };
  spec: {
    family: "template";
    capability: { summary: string };
    /** Required part-roles → the provider name (an entry in {@link PROVIDER_MANIFESTS}) backing it. */
    requiredParts: Record<string, string>;
    /**
     * Template-level infrastructure requirements that are not owned by any one part provider. Public-edge
     * exposure is modeled here: Caddy/nginx/Traefik-style proxy evidence is transport/dependency proof, not an
     * Access Gateway or AuthProvider replacement.
     */
    requires?: DependencyRequirement[];
    /**
     * The part-roles the agent MAY override (docs/04 §5 the fixed/open line). A role NOT listed here
     * is **template-FIXED** (the isolation tier / launcher native base / security-bearing wiring) —
     * an agent override of a fixed part is a REJECT, not a silent override (docs/04 §4/§5). When
     * absent, NO part is overridable (fail-closed: only what the template explicitly opens).
     */
    openParts?: string[];
    /**
     * For each OPEN part-role, the set of provider `use` names the agent may choose
     * (`relations.compatibleWith`, docs/04 §4 "only with providers the template/catalog mark
     * compatible"). An override with a provider not in this set is a REJECT even if it is available.
     */
    compatibleProviders?: Record<string, string[]>;
    /** The agent-parameterizable surface of the template itself (open params). */
    openParams?: ConfigSchema;
    probe?: string;
    skills?: SkillManifest[];
  };
}

// ── Provider manifests for the browser-handoff reference slice (docs/03 §5–§9) ────────────────

/** All six provider manifests the browser-handoff template requires. Keyed by provider name. */
export const PROVIDER_MANIFESTS: Record<string, ProviderManifest> = {
  // docs/03 §5 — DEFAULT Launcher, local-process T2 (the reference default per baseline §5).
  "launcher-process": {
    apiVersion: "gla.dev/v1",
    kind: "Launcher",
    metadata: { name: "launcher-process", version: "0.1.0" },
    spec: {
      family: "launcher",
      capability: {
        summary: "local-process (T2) capsule launcher",
        isolation_tier: "local-process",
        mounts: { host_paths: ["file", "directory"], modes: ["ro", "rw"] },
      },
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            default: "auto",
            enum: ["auto", "headless", "full"],
          },
          headless: { type: "boolean" },
          chromiumPath: { type: "string", minLength: 1 },
          startTimeoutMs: { type: "number", minimum: 1 },
        },
        allOf: [
          {
            not: {
              type: "object",
              required: ["mode", "headless"],
              properties: { mode: {}, headless: {} },
            },
          },
        ],
      },
      // The browser-runtime host dependency (GLA-007 stands it up via WPM); not seeded as bound.
      requires: [
        {
          dependency: "browser-runtime",
          hostTouching: true,
          connectionRefs: ["chromium"],
          bundle: {
            id: "browser-runtime",
            version: "0.1.0",
            declaredRequires: { "gla-core": "^0.1.0" },
          },
        },
      ],
      probe: "launcher-process",
      relations: {
        compatibleWith: { entrypoints: ["entrypoint-novnc"], connectors: ["connector-cdp"] },
      },
      skills: [
        {
          id: "use-launcher-process",
          for: "launcher-process",
          body: "# use-launcher-process\nSpawn capsules on the local-process tier; runs as the agent's own uid, priv-esc off.",
        },
      ],
    },
  },

  // docs/03 §6 — HumanEntrypoint, noVNC + websockify over Xvfb.
  "entrypoint-novnc": {
    apiVersion: "gla.dev/v1",
    kind: "HumanEntrypoint",
    metadata: { name: "entrypoint-novnc", version: "0.1.0" },
    spec: {
      family: "entrypoint",
      capability: {
        summary: "noVNC live-view human entrypoint (agent-blind input path)",
        client: {
          kind: "rfb-web-client",
          ref: "entrypoint-novnc.novnc",
          bootstrap: {
            module: "core/rfb.js",
            scaleViewport: true,
            resizeSession: false,
            viewOnly: false,
          },
        },
        clientAssets: [
          {
            ref: "entrypoint-novnc.novnc",
            source: "package",
            package: "@novnc/novnc",
            env: "GLA_NOVNC_WEB_ROOT",
            cacheControl: "no-cache",
          },
        ],
        transport: { kind: "reverse-proxy", protocols: ["websocket"] },
      },
      requires: [
        {
          dependency: "human-view",
          hostTouching: true,
          connectionRefs: ["novnc"],
          bundle: {
            id: "human-view",
            version: "0.1.0",
            declaredRequires: { "gla-core": "^0.1.0", "browser-runtime": "^0.1.0" },
          },
        },
      ],
      probe: "entrypoint-novnc",
    },
  },

  // docs/03 §7 — AgentConnector, CDP via Playwright.
  "connector-cdp": {
    apiVersion: "gla.dev/v1",
    kind: "AgentConnector",
    metadata: { name: "connector-cdp", version: "0.1.0" },
    spec: {
      family: "connector",
      capability: {
        summary: "Chrome DevTools Protocol agent connector (agent-blind)",
        dto: {
          type: "cdp",
          providerOwnedFields: ["cdp_url"],
          lifecycleKey: "resourceId",
        },
      },
      requires: [
        {
          dependency: "browser-runtime",
          hostTouching: true,
          connectionRefs: ["chromium"],
          bundle: {
            id: "browser-runtime",
            version: "0.1.0",
            declaredRequires: { "gla-core": "^0.1.0" },
          },
        },
      ],
      probe: "connector-cdp",
    },
  },

  // docs/03 §8 — Workspace, ephemeral browser-profile-temp.
  "workspace-profile": {
    apiVersion: "gla.dev/v1",
    kind: "Workspace",
    metadata: { name: "workspace-profile", version: "0.1.0" },
    spec: {
      family: "workspace",
      capability: { summary: "ephemeral browser-profile-temp workspace (wiped at reap)" },
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          root: { type: "string", minLength: 1 },
        },
      },
      // In-tree, no host dependency to stand up.
      probe: "workspace-profile",
    },
  },

  // docs/03 §9 — CompletionDetector, url-watcher. The agent-facing `use` name is `url-watcher`
  // (docs/04 §1, docs/05 §6, and the GLA-066 scenario calls); the in-tree adapter package is
  // `@gla/detector-url`, but the catalog registers the provider under the capability name the agent
  // composes with, so `{ "use": "url-watcher" }` resolves.
  "url-watcher": {
    apiVersion: "gla.dev/v1",
    kind: "CompletionDetector",
    metadata: { name: "url-watcher", version: "0.1.0" },
    spec: {
      family: "detector",
      capability: {
        summary: "url-watcher completion detector (fires on a configured URL)",
        completion: {
          statuses: {
            "url-intermediate": { status: "submitted", next: "email-verification" },
            "url-complete": { status: "verified" },
          },
          resultSchema: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: {
              url: { type: "string" },
              match: { type: "string" },
            },
          },
        },
      },
      config_schema: {
        type: "object",
        additionalProperties: false,
        required: ["complete_on"],
        properties: {
          complete_on: { type: "string", pattern: "^/" },
          // An optional INTERMEDIATE URL (e.g. `/verify`) — the watcher emits an intermediate signal on its first
          // match before the terminal `complete_on` (scenario-01 Phase 8: `/verify` → submitted, next email-verification).
          intermediate: { type: "string", pattern: "^/" },
        },
      },
      factory_config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pollMs: { type: "number", minimum: 1 },
        },
      },
      probe: "url-watcher",
      relations: { compatibleWith: { templates: ["browser-handoff"] } },
    },
  },

  // docs/03 §9 — CompletionDetector, user-done (the human's explicit done-signal).
  "user-done": {
    apiVersion: "gla.dev/v1",
    kind: "CompletionDetector",
    metadata: { name: "user-done", version: "0.1.0" },
    spec: {
      family: "detector",
      capability: {
        summary: "user-done completion detector (the human signals completion)",
        completion: {
          statuses: {
            done: { status: "verified" },
          },
        },
      },
      probe: "user-done",
      relations: { compatibleWith: { templates: ["browser-handoff"] } },
    },
  },
};

// ── The browser-handoff CapsuleTemplate (docs/05 §6 reference slice) ──────────────────────────

/** The reference-slice template: the same-session browser handoff (scenario-01). */
export const BROWSER_HANDOFF_TEMPLATE: TemplateManifest = {
  apiVersion: "gla.dev/v1",
  kind: "CapsuleTemplate",
  metadata: { name: "browser-handoff", version: "0.1.0" },
  spec: {
    family: "template",
    capability: { summary: "same-session browser handoff (human + agent on one capsule)" },
    // Each required part-role → the provider that backs it; `template show` reports each one's
    // backing dependency binding status (GLA-017 AC#2).
    requiredParts: {
      launcher: "launcher-process",
      entrypoint: "entrypoint-novnc",
      connector: "connector-cdp",
      workspace: "workspace-profile",
      detector: "url-watcher",
    },
    requires: [
      {
        dependency: "edge-proxy",
        hostTouching: true,
        connectionRefs: ["publicBaseUrl", "gatewayUpstream"],
        publicEdge: true,
        bundle: {
          id: "edge-proxy",
          version: "0.1.0",
          declaredRequires: { "gla-core": "^0.1.0" },
        },
      },
    ],
    // docs/04 §5 fixed/open line: the launcher (isolation tier / native base) and the workspace are
    // FIXED — an agent override of either is a reject. The agent MAY override the entrypoint, the
    // connector, and the detector(s), but only with a compatible provider derived from the catalog's
    // registered provider manifests.
    openParts: ["entrypoint", "connector", "detector"],
    openParams: {
      type: "object",
      additionalProperties: false,
      required: ["recipient"],
      properties: {
        recipient: { type: "string" },
        ttl: { type: "string", pattern: "^[0-9]+(s|m|h|d)$" },
      },
    },
    probe: "browser-handoff",
    skills: [
      {
        id: "browser-handoff",
        for: "browser-handoff",
        body: [
          "# browser-handoff",
          "",
          "Assemble a same-session browser capsule and hand it to a human inside a recipient-bound",
          "window. Compose: `template show browser-handoff` to see the required parts and their",
          "binding status, then `session create -f assembly.json --dry-run` before provisioning.",
          "",
          "- Drive the browser over the **connector (CDP)**, never via `gla`.",
          "- A handoff is the only way a human acts; never prompt the human on a terminal.",
          "- Completion is the result of `handoff wait`, validated against the detector contract.",
        ].join("\n"),
      },
    ],
  },
};

/** The channel-cli ChannelAdapter manifest (docs/03 §2) — the fallback channel, in-tree. */
export const CHANNEL_CLI_MANIFEST: ProviderManifest = {
  apiVersion: "gla.dev/v1",
  kind: "ChannelAdapter",
  metadata: { name: "channel-cli", version: "0.1.0" },
  spec: {
    family: "channel",
    capability: { summary: "local/CLI fallback channel (headless tests)" },
    config_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        delivery: { type: "string", enum: ["stdout", "injected"] },
        inbound: { type: "string", enum: ["memory", "injected"] },
      },
    },
    probe: "channel-cli",
  },
};
