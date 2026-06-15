// K4 — config_schema contract + validator (kernel-contracts.md §4, docs/04 §3).
// The public boundary stays deliberately small: provider authors publish a conservative JSON
// Schema object, and callers validate plain config data through validateConfig(). Validation is
// pure: no defaults are applied, no coercion happens, and unknown fields are not removed.

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv/dist/ajv.js";
import type { ErrorCode, GlaError } from "./errors.js";

/** JSON Schema types admitted by GLA's conservative provider config profile. */
export type ConfigSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * A JSON Schema node in GLA's conservative provider config profile.
 *
 * The profile intentionally keeps the expressive set small: object properties, required fields,
 * additionalProperties:false, primitive type checks, enum/const, string/number/array bounds,
 * nested objects/arrays, and simple composition for standard JSON Schema constraints such as
 * `not`/`allOf`. GLA metadata such as `x-gla-sensitive` is explicit data and is ignored by the
 * validator; redaction/default behavior remains owned by GLA code that chooses to read it.
 */
export interface ConfigSchemaNode {
  $schema?: string;
  title?: string;
  description?: string;
  type?: ConfigSchemaType | ConfigSchemaType[];
  properties?: Record<string, ConfigSchemaNode>;
  required?: string[];
  additionalProperties?: false;
  items?: ConfigSchemaNode;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  dependencies?: Record<string, string[]>;
  allOf?: ConfigSchemaNode[];
  anyOf?: ConfigSchemaNode[];
  oneOf?: ConfigSchemaNode[];
  not?: ConfigSchemaNode;
  default?: unknown;
  examples?: unknown[];
  "x-gla-sensitive"?: boolean;
}

/**
 * A provider's full option schema. The root is always a JSON Schema object and must close unknown
 * fields with `additionalProperties:false`.
 */
export interface ConfigSchema extends ConfigSchemaNode {
  type: "object";
  properties?: Record<string, ConfigSchemaNode>;
  required?: string[];
  additionalProperties: false;
}

/** Reusable empty schema: no accepted config fields, unknown fields rejected. */
export const EMPTY_CONFIG_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

/** A single defect found while validating params against a schema. */
export interface ConfigDefect {
  /** Dotted/bracket path to the offending config field, e.g. `limits.memory` or `tags[1]`. */
  field: string;
  code: ErrorCode;
  message: string;
}

/** Outcome of {@link validateConfig}: ok, or every defect found in one pass. */
export type ConfigValidation = { ok: true } | { ok: false; defects: ConfigDefect[] };

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 24;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_ARRAY_ITEMS = 512;

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  messages: true,
  removeAdditional: false,
  strictRequired: false,
  strictSchema: true,
  strictTuples: false,
  strictTypes: false,
  useDefaults: false,
  validateFormats: false,
});

ajv.addKeyword({
  keyword: "x-gla-sensitive",
  schemaType: "boolean",
});

const validatorCache = new WeakMap<ConfigSchema, ValidateFunction>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushDefect(
  defects: ConfigDefect[],
  field: string,
  code: ErrorCode,
  message: string,
): void {
  defects.push({ field, code, message });
}

function pointerToField(pointer: string): string {
  if (pointer.length === 0) {
    return "$";
  }
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let out = "";
  for (const part of parts) {
    if (/^[0-9]+$/.test(part)) {
      out += `[${part}]`;
    } else {
      out = out.length === 0 ? part : `${out}.${part}`;
    }
  }
  return out.length === 0 ? "$" : out;
}

function joinField(basePointer: string, child: unknown): string {
  const base = pointerToField(basePointer);
  const suffix = typeof child === "string" && child.length > 0 ? child : undefined;
  if (suffix === undefined) {
    return base;
  }
  return base === "$" ? suffix : `${base}.${suffix}`;
}

function schemaPath(pointer: string): string {
  return pointerToField(pointer).replace(/^\$/, "schema");
}

function schemaLimitDefects(schema: unknown): ConfigDefect[] {
  const defects: ConfigDefect[] = [];
  let json: string;
  try {
    json = JSON.stringify(schema);
  } catch {
    pushDefect(defects, "schema", "policy.denied", "config_schema must be JSON-serializable");
    return defects;
  }
  if (json.length > MAX_SCHEMA_BYTES) {
    pushDefect(
      defects,
      "schema",
      "policy.denied",
      `config_schema is too large (${json.length} bytes; max ${MAX_SCHEMA_BYTES})`,
    );
  }

  let nodes = 0;
  const seen = new WeakSet<object>();
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > MAX_SCHEMA_DEPTH) {
      pushDefect(
        defects,
        path,
        "policy.denied",
        `config_schema is too deeply nested (max depth ${MAX_SCHEMA_DEPTH})`,
      );
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      pushDefect(defects, path, "policy.denied", "config_schema contains a cycle");
      return;
    }
    seen.add(value);
    nodes++;
    if (nodes > MAX_SCHEMA_NODES) {
      pushDefect(
        defects,
        path,
        "policy.denied",
        `config_schema has too many nodes (max ${MAX_SCHEMA_NODES})`,
      );
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_SCHEMA_ARRAY_ITEMS) {
        pushDefect(
          defects,
          path,
          "policy.denied",
          `config_schema array is too large (max ${MAX_SCHEMA_ARRAY_ITEMS} items)`,
        );
        return;
      }
      value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      walk(child, path === "schema" ? key : `${path}.${key}`, depth + 1);
    }
  };
  walk(schema, "schema", 0);
  return defects;
}

function nodeDeclaresObject(node: Record<string, unknown>): boolean {
  return (
    node.type === "object" ||
    node.properties !== undefined ||
    node.additionalProperties !== undefined
  );
}

function profileDefects(schema: unknown): ConfigDefect[] {
  const defects: ConfigDefect[] = [];
  if (!isRecord(schema)) {
    pushDefect(defects, "schema", "policy.denied", "config_schema must be a JSON object schema");
    return defects;
  }
  if (schema.type !== "object") {
    pushDefect(defects, "type", "policy.denied", 'config_schema root type must be "object"');
  }
  if (schema.additionalProperties !== false) {
    pushDefect(
      defects,
      "additionalProperties",
      "policy.denied",
      "config_schema root must declare additionalProperties:false",
    );
  }

  const walk = (node: unknown, path: string): void => {
    if (!isRecord(node)) {
      pushDefect(defects, path, "policy.denied", "config_schema node must be an object");
      return;
    }
    if (nodeDeclaresObject(node) && node.additionalProperties !== false) {
      pushDefect(
        defects,
        `${path}.additionalProperties`,
        "policy.denied",
        "object schemas must declare additionalProperties:false",
      );
    }
    if (node.properties !== undefined && !isRecord(node.properties)) {
      pushDefect(defects, `${path}.properties`, "policy.denied", "properties must be an object");
    }
    if (Array.isArray(node.required)) {
      for (const required of node.required) {
        if (typeof required !== "string" || required.length === 0) {
          pushDefect(
            defects,
            `${path}.required`,
            "policy.denied",
            "required entries must be non-empty strings",
          );
        }
      }
    } else if (node.required !== undefined) {
      pushDefect(defects, `${path}.required`, "policy.denied", "required must be a string array");
    }
    if (node.type === "array" && node.items !== undefined) {
      walk(node.items, `${path}.items`);
    }
    if (isRecord(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        walk(property, `${path}.properties.${name}`);
      }
    }
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      const branch = node[key];
      if (branch !== undefined) {
        if (!Array.isArray(branch)) {
          pushDefect(defects, `${path}.${key}`, "policy.denied", `${key} must be an array`);
        } else {
          branch.forEach((item, index) => walk(item, `${path}.${key}[${index}]`));
        }
      }
    }
    if (node.not !== undefined) {
      walk(node.not, `${path}.not`);
    }
    if (node.dependencies !== undefined && !isRecord(node.dependencies)) {
      pushDefect(
        defects,
        `${path}.dependencies`,
        "policy.denied",
        "dependencies must be an object of string arrays",
      );
    } else if (isRecord(node.dependencies)) {
      for (const [name, deps] of Object.entries(node.dependencies)) {
        if (!Array.isArray(deps) || deps.some((dep) => typeof dep !== "string")) {
          pushDefect(
            defects,
            `${path}.dependencies.${name}`,
            "policy.denied",
            "dependencies entries must be string arrays",
          );
        }
      }
    }
  };
  walk(schema, "schema");
  return defects;
}

function shapeErrorsFromAjv(errors: ErrorObject[] | null | undefined): ConfigDefect[] {
  return (errors ?? []).map((error) => ({
    field: schemaPath(error.instancePath || error.schemaPath),
    code: "policy.denied",
    message: `config_schema is invalid: ${error.message ?? error.keyword}`,
  }));
}

function shapeDefects(schema: unknown): ConfigDefect[] {
  const defects = [...schemaLimitDefects(schema), ...profileDefects(schema)];
  if (defects.length > 0) {
    return defects;
  }
  const jsonSchema = schema as ConfigSchema;
  const schemaValid = ajv.validateSchema(jsonSchema);
  if (!schemaValid) {
    return shapeErrorsFromAjv(ajv.errors);
  }
  try {
    ajv.compile(jsonSchema);
  } catch (error) {
    return [
      {
        field: "schema",
        code: "policy.denied",
        message: `config_schema cannot be compiled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    ];
  }
  return [];
}

function validatorFor(schema: ConfigSchema): ConfigValidation | ValidateFunction {
  const defects = shapeDefects(schema);
  if (defects.length > 0) {
    return { ok: false, defects };
  }
  const cached = validatorCache.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const compiled = ajv.compile(schema);
  validatorCache.set(schema, compiled);
  return compiled;
}

function typeName(type: unknown): string {
  return Array.isArray(type) ? type.join(" or ") : String(type);
}

function validationField(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (error.keyword === "required") {
    return joinField(error.instancePath, params.missingProperty);
  }
  if (error.keyword === "additionalProperties") {
    return joinField(error.instancePath, params.additionalProperty);
  }
  if (error.keyword === "dependencies") {
    return joinField(error.instancePath, params.property);
  }
  return pointerToField(error.instancePath);
}

function validationMessage(error: ErrorObject, field: string): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "required":
      return `required field "${field}" is missing`;
    case "additionalProperties":
      return `unknown field "${field}" is not in the provider config_schema`;
    case "type":
      return `field "${field}" must be of type ${typeName(params.type)}`;
    case "enum":
      return `field "${field}" must be one of ${JSON.stringify(error.schema)}`;
    case "const":
      return `field "${field}" must equal ${JSON.stringify(error.schema)}`;
    case "minimum":
      return `field "${field}" must be >= ${params.limit}`;
    case "maximum":
      return `field "${field}" must be <= ${params.limit}`;
    case "exclusiveMinimum":
      return `field "${field}" must be > ${params.limit}`;
    case "exclusiveMaximum":
      return `field "${field}" must be < ${params.limit}`;
    case "minLength":
      return `field "${field}" must have length >= ${params.limit}`;
    case "maxLength":
      return `field "${field}" must have length <= ${params.limit}`;
    case "pattern":
      return `field "${field}" must match pattern ${params.pattern}`;
    case "minItems":
      return `field "${field}" must have >= ${params.limit} items`;
    case "maxItems":
      return `field "${field}" must have <= ${params.limit} items`;
    case "dependencies":
      return `field "${field}" requires ${String(params.deps)}`;
    case "not":
      return `field "${field}" violates a not constraint`;
    default:
      return `field "${field}" ${error.message ?? "does not match config_schema"}`;
  }
}

function validationErrors(errors: ErrorObject[] | null | undefined): ConfigDefect[] {
  return (errors ?? []).map((error) => {
    const field = validationField(error);
    return {
      field,
      code: "policy.denied",
      message: validationMessage(error, field),
    };
  });
}

/**
 * Validate a params object against a provider's JSON Schema config_schema. The validator is
 * all-errors and fail-closed, but intentionally non-mutating: defaults, coercion, removal of
 * unknown fields, and redaction metadata are explicit GLA behavior outside this function.
 */
export function validateConfig(
  schema: ConfigSchema,
  params: Record<string, unknown>,
): ConfigValidation {
  const validator = validatorFor(schema);
  if (typeof validator !== "function") {
    return validator;
  }
  const ok = validator(params);
  return ok ? { ok: true } : { ok: false, defects: validationErrors(validator.errors) };
}

/**
 * Structural check that a config_schema is itself a valid member of GLA's conservative JSON
 * Schema profile before it can constrain provider config. Oversized, cyclic, out-of-profile, and
 * uncompileable schemas return typed diagnostics instead of throwing.
 */
export function validateSchemaShape(schema: unknown): ConfigValidation {
  const defects = shapeDefects(schema);
  return defects.length === 0 ? { ok: true } : { ok: false, defects };
}

/** Turn config defects into the wire {@link GlaError}. */
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
