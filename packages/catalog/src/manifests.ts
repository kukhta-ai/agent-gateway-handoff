// In-tree catalog manifest data (the "Store" content for Slice 1). docs/02 §3 (the uniform
// provider-manifest contract) + docs/03 (the reference-slice software per layer). These are the
// git-tracked descriptors the Ingester ingests; loading them from in-tree data (rather than a YAML
// directory walk) keeps Slice 1 hermetic and dependency-free while preserving the manifest SHAPE,
// so a real Store that reads YAML files plugs in behind the same Ingester later with no API change.
//
// Seeds the browser-handoff CapsuleTemplate + the six provider manifests it requires
// (launcher-process, entrypoint-novnc, connector-cdp, workspace-profile, detector-url, user-done),
// each with a DependencyBinding status, plus a browser-handoff Skill (a short SKILL.md body).

import type { ConfigSchema } from "@gla/kernel";

/** The pluggable provider families (docs/02 §3) this slice seeds. */
export type ProviderFamily =
  | "launcher"
  | "entrypoint"
  | "connector"
  | "workspace"
  | "detector"
  | "channel"
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

/**
 * The dependency a provider requires on the host, with its current binding (docs/02 §6). For an
 * in-tree provider with no host dependency the binding is `bound` with mode `managed` (nothing to
 * stand up). The `probe` name is the system-derived health seam (resolved by the Index, not here).
 */
export interface DependencyBinding {
  /** The dependency name (matches what a `wpm` bundle stands up). */
  dependency: string;
  status: BindingStatus;
  ownershipMode: OwnershipMode;
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
 * typed `config_schema` (the agent's option surface), the required dependency + its binding, the
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
    /** The host dependency this provider needs + its binding (drives availability). */
    requires?: DependencyBinding[];
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
        headless: { type: "bool", required: false, default: true },
      },
      // The browser-runtime host dependency (GLA-007 stands it up via wpm); seeded bound in-tree.
      requires: [{ dependency: "browser-runtime", status: "bound", ownershipMode: "managed" }],
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
      capability: { summary: "noVNC live-view human entrypoint (agent-blind input path)" },
      requires: [{ dependency: "human-view", status: "bound", ownershipMode: "managed" }],
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
      capability: { summary: "Chrome DevTools Protocol agent connector (agent-blind)" },
      requires: [{ dependency: "browser-runtime", status: "bound", ownershipMode: "managed" }],
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
      // In-tree, no host dependency to stand up.
      probe: "workspace-profile",
    },
  },

  // docs/03 §9 — CompletionDetector, url-watcher.
  "detector-url": {
    apiVersion: "gla.dev/v1",
    kind: "CompletionDetector",
    metadata: { name: "detector-url", version: "0.1.0" },
    spec: {
      family: "detector",
      capability: { summary: "url-watcher completion detector (fires on a configured URL)" },
      config_schema: {
        complete_on: { type: "string", required: true, pattern: "^/" },
      },
      probe: "detector-url",
    },
  },

  // docs/03 §9 — CompletionDetector, user-done (the human's explicit done-signal).
  "user-done": {
    apiVersion: "gla.dev/v1",
    kind: "CompletionDetector",
    metadata: { name: "user-done", version: "0.1.0" },
    spec: {
      family: "detector",
      capability: { summary: "user-done completion detector (the human signals completion)" },
      probe: "user-done",
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
      detector: "detector-url",
    },
    openParams: {
      recipient: { type: "string", required: true },
      ttl: { type: "string", required: false, pattern: "^[0-9]+(s|m|h|d)$" },
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
    probe: "channel-cli",
  },
};
