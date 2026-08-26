// K4 — typed config_schema vocabulary + validator (kernel-contracts.md §4, docs/04 §3).
// The mechanism that makes authoring allowlist-by-construction: a provider declares the typed
// set of options the agent may set; anything off-schema is rejected OFFLINE, before anything
// runs, and the rejection NAMES the offending field (task AC#5). Pure: no I/O, no host touch.
//
// Defects are collected in a SINGLE PASS (never fail-fast) so the agent sees every problem at
// once — same discipline as the AssemblySpec validator.

import type { ErrorCode, GlaError } from "./errors.js";

/** The closed set of value types a config field may declare (§4). */
export type ConfigType = "string" | "number" | "bool" | "enum" | "object" | "list";

/**
 * One typed option a provider exposes (§4). The trusted provider/template author draws the line
 * once — which native knobs become options and their bounds; the untrusted agent only sets
 * conforming values.
 */
export interface ConfigField {
  type: ConfigType;
  /** Required ⇒ must be present; else optional. */
  required?: boolean;
  /** Applied at admission-mutate when omitted (not enforced by validation here). */
  default?: unknown;
  /** Closed set of allowed values (for `enum`, or to restrict a `string`/`number`). */
  enum?: unknown[];
  /** Range for `number`; length bound for `string` and `list`. */
  min?: number;
  max?: number;
  /** Regex the whole `string` value must match. */
  pattern?: string;
  /** Sibling fields this one may NOT be set together with. */
  conflicts_with?: string[];
  /** Sibling fields that MUST be set together with this one. */
  required_with?: string[];
  /** A secret-ref, never a literal — never echoed in schema/catalog output or logs. */
  sensitive?: boolean;
  /** Field set for `type:"object"`. */
  fields?: Record<string, ConfigField>;
  /** Element schema for `type:"list"`. */
  items?: ConfigField;
}

/** A provider's full option schema: field-name → typed {@link ConfigField} (§4). */
export type ConfigSchema = Record<string, ConfigField>;

/** A single defect found while validating params against a schema — carries the offending field. */
export interface ConfigDefect {
  /** Dotted path to the offending field, e.g. `"viewport"` or `"limits.memory"`. The NAMED field. */
  field: string;
  code: ErrorCode;
  message: string;
}

/** Outcome of {@link validateConfig}: ok, or every defect found in one pass (each names a field). */
export type ConfigValidation = { ok: true } | { ok: false; defects: ConfigDefect[] };

function typeOfValue(v: unknown): ConfigType | "null" | "unknown" {
  if (v === null) {
    return "null";
  }
  if (typeof v === "boolean") {
    return "bool";
  }
  if (typeof v === "number") {
    return "number";
  }
  if (typeof v === "string") {
    return "string";
  }
  if (Array.isArray(v)) {
    return "list";
  }
  if (typeof v === "object") {
    return "object";
  }
  return "unknown";
}

/** Does a concrete value match the declared field `type`? (`enum` accepts any JSON value.) */
function valueMatchesType(value: unknown, type: ConfigType): boolean {
  switch (type) {
    case "enum":
      return true; // membership is checked separately against `enum`
    case "object":
      return typeOfValue(value) === "object";
    case "list":
      return Array.isArray(value);
    default:
      return typeOfValue(value) === type;
  }
}

function pushDefect(
  defects: ConfigDefect[],
  field: string,
  code: ErrorCode,
  message: string,
): void {
  defects.push({ field, code, message });
}

/** Validate one field's present value (type, enum, range/length, pattern, nested). Collects all. */
function validateValue(
  path: string,
  field: ConfigField,
  value: unknown,
  defects: ConfigDefect[],
): void {
  if (!valueMatchesType(value, field.type)) {
    pushDefect(
      defects,
      path,
      "policy.denied",
      `field "${path}" must be of type ${field.type}, got ${typeOfValue(value)}`,
    );
    return; // type wrong → range/enum checks would be noise; other fields still validate
  }

  // enum membership (deep-equal by JSON for objects/arrays; strict for primitives).
  if (field.enum !== undefined) {
    const ok = field.enum.some((allowed) =>
      typeof allowed === "object" && allowed !== null
        ? JSON.stringify(allowed) === JSON.stringify(value)
        : allowed === value,
    );
    if (!ok) {
      pushDefect(
        defects,
        path,
        "policy.denied",
        `field "${path}" must be one of ${JSON.stringify(field.enum)}`,
      );
    }
  }

  // range (number) / length (string, list)
  if (typeof value === "number") {
    if (field.min !== undefined && value < field.min) {
      pushDefect(defects, path, "policy.denied", `field "${path}" must be >= ${field.min}`);
    }
    if (field.max !== undefined && value > field.max) {
      pushDefect(defects, path, "policy.denied", `field "${path}" must be <= ${field.max}`);
    }
  } else if (typeof value === "string") {
    if (field.min !== undefined && value.length < field.min) {
      pushDefect(
        defects,
        path,
        "policy.denied",
        `field "${path}" must have length >= ${field.min}`,
      );
    }
    if (field.max !== undefined && value.length > field.max) {
      pushDefect(
        defects,
        path,
        "policy.denied",
        `field "${path}" must have length <= ${field.max}`,
      );
    }
    if (field.pattern !== undefined) {
      let re: RegExp | undefined;
      try {
        re = new RegExp(field.pattern);
      } catch {
        re = undefined;
      }
      if (re && !re.test(value)) {
        pushDefect(
          defects,
          path,
          "policy.denied",
          `field "${path}" must match pattern ${field.pattern}`,
        );
      }
    }
  } else if (Array.isArray(value)) {
    if (field.min !== undefined && value.length < field.min) {
      pushDefect(defects, path, "policy.denied", `field "${path}" must have >= ${field.min} items`);
    }
    if (field.max !== undefined && value.length > field.max) {
      pushDefect(defects, path, "policy.denied", `field "${path}" must have <= ${field.max} items`);
    }
    // Validate each element against `items` (if declared).
    if (field.items !== undefined) {
      value.forEach((el, i) => {
        validateValue(`${path}[${i}]`, field.items as ConfigField, el, defects);
      });
    }
  }

  // nested object fields
  if (field.type === "object" && field.fields !== undefined && typeOfValue(value) === "object") {
    validateAgainst(field.fields, value as Record<string, unknown>, path, defects);
  }
}

/** Validate a params object against a (sub)schema, accumulating defects (single pass). */
function validateAgainst(
  schema: ConfigSchema,
  params: Record<string, unknown>,
  prefix: string,
  defects: ConfigDefect[],
): void {
  const at = (name: string): string => (prefix === "" ? name : `${prefix}.${name}`);
  const isSet = (name: string): boolean =>
    Object.hasOwn(params, name) && params[name] !== undefined;

  // Unknown fields: off-schema input is rejected, naming the field (allowlist-by-construction).
  for (const name of Object.keys(params)) {
    if (!Object.hasOwn(schema, name)) {
      pushDefect(
        defects,
        at(name),
        "policy.denied",
        `unknown field "${at(name)}" is not in the provider config_schema`,
      );
    }
  }

  for (const [name, field] of Object.entries(schema)) {
    const present = isSet(name);
    const path = at(name);

    if (!present) {
      if (field.required === true) {
        pushDefect(defects, path, "policy.denied", `required field "${path}" is missing`);
      }
      continue; // absent + optional → nothing more to check for this field
    }

    // present: value-level checks
    validateValue(path, field, params[name], defects);

    // cross-field: conflicts_with
    if (field.conflicts_with !== undefined) {
      for (const other of field.conflicts_with) {
        if (isSet(other)) {
          pushDefect(
            defects,
            path,
            "policy.denied",
            `field "${path}" conflicts with "${at(other)}" — they may not be set together`,
          );
        }
      }
    }
    // cross-field: required_with
    if (field.required_with !== undefined) {
      for (const other of field.required_with) {
        if (!isSet(other)) {
          pushDefect(
            defects,
            path,
            "policy.denied",
            `field "${path}" requires "${at(other)}" to also be set`,
          );
        }
      }
    }
  }
}

/**
 * Validate a `params` object against a provider's typed {@link ConfigSchema} — OFFLINE, before
 * anything runs (§4, AC#5). Checks type, enum, range/length, pattern, unknown fields, required,
 * and the `conflicts_with` / `required_with` cross-field rules, **collecting every defect in a
 * single pass** and **naming the offending field** in each. A violating value yields
 * `{ ok: false, defects }`; a conforming object yields `{ ok: true }`.
 */
export function validateConfig(
  schema: ConfigSchema,
  params: Record<string, unknown>,
): ConfigValidation {
  const defects: ConfigDefect[] = [];
  validateAgainst(schema, params, "", defects);
  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}

/**
 * Structural check that a {@link ConfigSchema} is itself well-formed (the ingester asserts this:
 * a `config_schema` must be valid before it can constrain anything — §4). Single-pass, collects
 * every structural defect. This is the "schema is valid JSON-Schema-class" guard the kernel owns
 * without pulling in a full JSON-Schema engine.
 */
export function validateSchemaShape(schema: ConfigSchema): ConfigValidation {
  const defects: ConfigDefect[] = [];
  const types: ReadonlySet<ConfigType> = new Set<ConfigType>([
    "string",
    "number",
    "bool",
    "enum",
    "object",
    "list",
  ]);

  const walk = (s: ConfigSchema, prefix: string): void => {
    for (const [name, field] of Object.entries(s)) {
      const path = prefix === "" ? name : `${prefix}.${name}`;
      if (field === null || typeof field !== "object") {
        pushDefect(defects, path, "policy.denied", `field "${path}" is not a config-field object`);
        continue;
      }
      if (!types.has(field.type)) {
        pushDefect(
          defects,
          path,
          "policy.denied",
          `field "${path}" has unknown type "${String(field.type)}"`,
        );
      }
      if (field.type === "enum" && (field.enum === undefined || field.enum.length === 0)) {
        pushDefect(
          defects,
          path,
          "policy.denied",
          `enum field "${path}" must declare a non-empty "enum" set`,
        );
      }
      if (field.type === "object" && field.fields !== undefined) {
        walk(field.fields, path);
      }
      if (field.type === "list" && field.items !== undefined) {
        walk({ [`${name}[]`]: field.items }, prefix);
      }
    }
  };

  walk(schema, "");
  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}

/** Turn config defects into the wire {@link GlaError} (the first defect is the headline; all in `detail`). */
export function configDefectsToError(
  defects: ConfigDefect[],
  skill = "interpret-gla-rejections",
): GlaError {
  const head = defects[0];
  return {
    code: head?.code ?? "policy.denied",
    message: head?.message ?? "config validation failed",
    detail: { defects },
    skill,
    retryable: false,
  };
}
