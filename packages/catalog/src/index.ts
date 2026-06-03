// @gla/catalog — core-adjacent ring (baseline §1).
// The system's typed configuration model: Store → Ingester → Index (docs/02 §4, components/catalog.md).
// It holds the entity descriptors, ingests them through a mutate-then-validate pipeline, and exposes
// a queryable index whose availability is **system-derived** (a probe seam), never author-declared
// (the frozen invariant). This is the read surface the Agent Bridge serves at orient (Phase 1) and
// Admission checks at propose (Phase 2). Slice 1 implements the read contract GLA-017 needs:
//   list({kind?, available?}) · show(id) · resolveTemplate(id)/templateShow(id) · skillList/skillShow
//
// It depends ONLY on @gla/kernel (the CatalogPort + the config-schema validator). The concrete probe
// implementations and the YAML Store are seams; Slice 1 loads in-tree manifest data and stubs probes
// to `available` for in-tree parts, while keeping the seam so flipping a probe drops the entity.

import {
  type CatalogEntity,
  type CatalogPort,
  type ConfigSchema,
  type TemplateDescriptor,
  glaError,
  validateSchemaShape,
} from "@gla/kernel";
import {
  BROWSER_HANDOFF_TEMPLATE,
  type BindingStatus,
  CHANNEL_CLI_MANIFEST,
  type DependencyBinding,
  PROVIDER_MANIFESTS,
  type ProviderManifest,
  type SkillManifest,
  type TemplateManifest,
} from "./manifests.js";

export * from "./manifests.js";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const CATALOG_MODULE = "@gla/catalog" as const;
/** Ring classification from the architecture baseline (informational). */
export const CATALOG_RING = "core-adjacent" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Availability — SYSTEM-DERIVED via a probe seam (docs/02 §4, invariant)
// ─────────────────────────────────────────────────────────────────────────────

/** The system-derived availability of an entity (docs/02 §4): never author-declared. */
export type Availability = "available" | "degraded" | "unavailable";

/**
 * A probe: the health/contract check that proves a provider actually works (docs/02 §3 `probe`).
 * It returns the live availability — the Index derives the indexed status from this + the
 * dependency bindings, so a provider whose probe fails shows as `unavailable` and admission rejects
 * assemblies that need it. Stub probes for in-tree parts return `available`.
 */
export type Probe = () => Availability;

/** The default probe for an in-tree part with all dependencies bound: `available`. */
const ALWAYS_AVAILABLE: Probe = () => "available";

/**
 * Derive an entity's availability from (a) its dependency bindings and (b) its probe — SYSTEM-
 * derived, never read from the manifest. An `unbound`/`disabled` dependency forces `unavailable`; a
 * `degraded` binding caps at `degraded`; otherwise the probe result wins. This is the single place
 * availability is computed.
 */
function deriveAvailability(requires: DependencyBinding[] | undefined, probe: Probe): Availability {
  for (const dep of requires ?? []) {
    if (dep.status === "unbound" || dep.ownershipMode === "disabled") {
      return "unavailable";
    }
  }
  const probed = probe();
  if (probed === "unavailable") {
    return "unavailable";
  }
  const anyDegraded = (requires ?? []).some((d) => d.status === "degraded");
  if (anyDegraded || probed === "degraded") {
    return "degraded";
  }
  return "available";
}

// ─────────────────────────────────────────────────────────────────────────────
// The indexed entity — what list/show return
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An ingested + indexed catalog entity (the Index row). Extends the kernel's open
 * {@link CatalogEntity} (so it satisfies `CatalogPort`) with the slice's read fields: the family,
 * a capability summary, the system-derived availability, and (for providers) the dependency
 * bindings that drive it. `available` is the boolean the kernel port exposes; `availability` is the
 * three-valued system-derived status.
 */
export interface IndexedEntity extends CatalogEntity {
  name: string;
  kind: string;
  family: string;
  summary: string;
  /** SYSTEM-DERIVED (probe + bindings). The boolean `available` = (availability === "available"). */
  available: boolean;
  availability: Availability;
  /** The dependency bindings backing this provider (empty for pure in-tree parts). */
  requires: DependencyBinding[];
}

/** The binding status of one required part, as `template show` reports it (GLA-017 AC#2). */
export interface PartBinding {
  /** The part-role (launcher | entrypoint | connector | workspace | detector). */
  part: string;
  /** The provider backing the part. */
  provider: string;
  /** The provider's system-derived availability. */
  availability: Availability;
  /** Each backing dependency's binding status. */
  dependencies: DependencyBinding[];
}

/** What `templateShow` returns (GLA-017 AC#2): required parts + each backing dependency's binding. */
export interface TemplateShowResult extends TemplateDescriptor {
  id: string;
  /** The required part-roles (kernel TemplateDescriptor shape). */
  requiredParts: string[];
  openParams: ConfigSchema;
  available: boolean;
  availability: Availability;
  /** Per required part, the backing provider + its dependency binding status. */
  parts: PartBinding[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Store → Ingester → Index
// ─────────────────────────────────────────────────────────────────────────────

/** The raw descriptors the Store holds (docs/02 §4 step 1). In Slice 1: in-tree manifest data. */
export interface StoreContent {
  providers: ProviderManifest[];
  templates: TemplateManifest[];
}

/** Per-probe-name overrides for tests/wiring (flip a part's probe to prove system-derived drop). */
export type ProbeRegistry = Record<string, Probe>;

interface IngestResult {
  entities: Map<string, IndexedEntity>;
  templates: Map<string, TemplateManifest>;
  skills: Map<string, SkillManifest>;
}

/**
 * The Ingester (docs/02 §4): for each manifest — **mutate** (defaults already applied in-tree),
 * **validate** (the manifest conforms to its family shape AND its `config_schema` is itself valid
 * JSON-Schema — the kernel's `validateSchemaShape`), then **index** with system-derived availability
 * (the probe + bindings). A manifest that fails validation is rejected at ingest and never reaches
 * the index (so an unlisted entity is inert — the catalog invariant). Skills are registered with the
 * skill manifest; relations are kept for `template show`.
 */
function ingest(content: StoreContent, probes: ProbeRegistry): IngestResult {
  const entities = new Map<string, IndexedEntity>();
  const templates = new Map<string, TemplateManifest>();
  const skills = new Map<string, SkillManifest>();

  const probeFor = (name: string | undefined): Probe => (name && probes[name]) || ALWAYS_AVAILABLE;

  const registerSkills = (list: SkillManifest[] | undefined): void => {
    for (const s of list ?? []) {
      skills.set(s.id, s);
    }
  };

  for (const m of content.providers) {
    // VALIDATE: a config_schema (if declared) must itself be valid before it can constrain anything.
    if (m.spec.config_schema !== undefined) {
      const shape = validateSchemaShape(m.spec.config_schema);
      if (!shape.ok) {
        throw glaError(
          "policy.denied",
          `provider "${m.metadata.name}" has an invalid config_schema`,
          {
            detail: { defects: shape.defects },
          },
        );
      }
    }
    const availability = deriveAvailability(m.spec.requires, probeFor(m.spec.probe));
    entities.set(m.metadata.name, {
      name: m.metadata.name,
      kind: m.kind,
      family: m.spec.family,
      summary: m.spec.capability.summary,
      availability,
      available: availability === "available",
      requires: m.spec.requires ?? [],
    });
    registerSkills(m.spec.skills);
  }

  for (const t of content.templates) {
    if (t.spec.openParams !== undefined) {
      const shape = validateSchemaShape(t.spec.openParams);
      if (!shape.ok) {
        throw glaError("policy.denied", `template "${t.metadata.name}" has invalid openParams`, {
          detail: { defects: shape.defects },
        });
      }
    }
    templates.set(t.metadata.name, t);
    // A template is available iff its own probe is available AND every required part is available.
    const ownProbe = probeFor(t.spec.probe)();
    const partsAvailable = Object.values(t.spec.requiredParts).every(
      (provider) => entities.get(provider)?.availability === "available",
    );
    const availability: Availability =
      ownProbe === "unavailable" || !partsAvailable
        ? Object.values(t.spec.requiredParts).some(
            (p) => entities.get(p)?.availability === "unavailable",
          ) || ownProbe === "unavailable"
          ? "unavailable"
          : "degraded"
        : "available";
    entities.set(t.metadata.name, {
      name: t.metadata.name,
      kind: t.kind,
      family: t.spec.family,
      summary: t.spec.capability.summary,
      availability,
      available: availability === "available",
      requires: [],
    });
    registerSkills(t.spec.skills);
  }

  return { entities, templates, skills };
}

// ─────────────────────────────────────────────────────────────────────────────
// CatalogService — the read API (CatalogPort + the slice's richer reads)
// ─────────────────────────────────────────────────────────────────────────────

/** Options to build a CatalogService: the Store content + an optional probe registry. */
export interface CatalogServiceOptions {
  content?: StoreContent;
  /** Per-probe overrides; a missing probe defaults to `available` (in-tree parts). */
  probes?: ProbeRegistry;
}

/**
 * The default in-tree Store content for the browser-handoff reference slice. Returns a DEEP CLONE
 * of the module-level seed manifests so a caller (or a test) can mutate a binding/probe on the
 * returned content without corrupting the shared seed — each `CatalogService` gets an isolated
 * Store, matching how a real (file-backed) Store hands the Ingester a fresh read each time.
 */
export function defaultStoreContent(): StoreContent {
  return structuredClone({
    providers: [...Object.values(PROVIDER_MANIFESTS), CHANNEL_CLI_MANIFEST],
    templates: [BROWSER_HANDOFF_TEMPLATE],
  });
}

/**
 * The Catalog read service (components/catalog.md). Constructed from Store content (defaults to the
 * in-tree reference slice) and a probe registry; it ingests once at construction and serves the
 * read surface. Implements the kernel {@link CatalogPort} (list/show/resolveTemplate) plus the
 * slice's richer `templateShow`/`skillList`/`skillShow`. All reads are side-effect-free
 * (GLA-017 AC#4): the service mutates nothing after ingest.
 */
export class CatalogService implements CatalogPort {
  private readonly index: IngestResult;
  private readonly store: StoreContent;

  constructor(opts: CatalogServiceOptions = {}) {
    this.store = opts.content ?? defaultStoreContent();
    this.index = ingest(this.store, opts.probes ?? {});
  }

  /**
   * List indexed entities (docs/05 `catalog list`), filtered by `kind` and/or `available`. When
   * `available: true`, only entities whose SYSTEM-DERIVED availability is `available` are returned —
   * never anything the caller asserted (GLA-017 AC#3). Read-only.
   */
  list(filter?: { kind?: string; available?: boolean }): IndexedEntity[] {
    let rows = [...this.index.entities.values()];
    if (filter?.kind !== undefined) {
      const k = filter.kind.toLowerCase();
      rows = rows.filter((e) => e.kind.toLowerCase() === k || e.family.toLowerCase() === k);
    }
    if (filter?.available === true) {
      rows = rows.filter((e) => e.available);
    }
    // Stable order by name so output is deterministic.
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Look up one entity by name (docs/05 `catalog`/`template`/`skill show` lookups). Read-only. */
  show(name: string): IndexedEntity | undefined {
    return this.index.entities.get(name);
  }

  /**
   * Resolve a template to the kernel {@link TemplateDescriptor} (required parts + open-param schema
   * + binding status). Returns `undefined` for an unknown id (the CLI maps that to exit 5). Used by
   * Admission and the Bridge. Read-only.
   */
  resolveTemplate(id: string): TemplateDescriptor | undefined {
    const show = this.tryTemplateShow(id);
    if (show === undefined) {
      return undefined;
    }
    return {
      id: show.id,
      requiredParts: show.requiredParts,
      openParams: show.openParams,
      available: show.available,
      parts: show.parts,
    };
  }

  /**
   * Show a template (docs/05 `template show <id>`, GLA-017 AC#2): its required parts and, per part,
   * the backing provider + **each backing dependency's binding status**. Throws the kernel's
   * not-found error for an unknown id (the CLI maps `catalog.unknown` → exit 5).
   */
  templateShow(id: string): TemplateShowResult {
    const show = this.tryTemplateShow(id);
    if (show === undefined) {
      throw glaError("catalog.unknown", `unknown template: "${id}"`, { detail: { id } });
    }
    return show;
  }

  /** Internal: build the TemplateShowResult, or undefined if the template is unknown. */
  private tryTemplateShow(id: string): TemplateShowResult | undefined {
    const t = this.index.templates.get(id);
    if (t === undefined) {
      return undefined;
    }
    const parts: PartBinding[] = Object.entries(t.spec.requiredParts).map(([part, provider]) => {
      const ent = this.index.entities.get(provider);
      return {
        part,
        provider,
        availability: ent?.availability ?? "unavailable",
        dependencies: ent?.requires ?? [],
      };
    });
    const entity = this.index.entities.get(id);
    const availability = entity?.availability ?? "unavailable";
    return {
      id,
      requiredParts: Object.keys(t.spec.requiredParts),
      openParams: t.spec.openParams ?? {},
      available: availability === "available",
      availability,
      parts,
    };
  }

  /** List registered skills (docs/05 `skill list`), optionally those `--for` a template. Read-only. */
  skillList(filter?: { for?: string }): Array<{ id: string; for?: string }> {
    let rows = [...this.index.skills.values()];
    if (filter?.for !== undefined) {
      rows = rows.filter((s) => s.for === filter.for);
    }
    return rows
      .map((s) => (s.for !== undefined ? { id: s.id, for: s.for } : { id: s.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Show a skill (docs/05 `skill show <id>`): emit the SKILL.md body. Throws the kernel's not-found
   * error for an unknown id (→ exit 5). Read-only.
   */
  skillShow(id: string): { id: string; for?: string; body: string } {
    const s = this.index.skills.get(id);
    if (s === undefined) {
      throw glaError("catalog.unknown", `unknown skill: "${id}"`, { detail: { id } });
    }
    return s.for !== undefined
      ? { id: s.id, for: s.for, body: s.body }
      : { id: s.id, body: s.body };
  }
}

export type { BindingStatus };
