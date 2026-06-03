// @gla/kernel — core ring (baseline §1).
// Pure domain: entities + state machines, the capability primitive (signing-independent) + a
// reference HMAC signer, the AssemblySpec contract + offline validator, the typed config_schema
// validator, the module ports, and the error/exit taxonomy. ZERO third-party runtime imports —
// only Node builtins (node:crypto in the reference signer). This barrel is the published surface
// other packages import (kernel-contracts.md §0, GLA-004 AC#7).

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const KERNEL_MODULE = "@gla/kernel" as const;
/** Ring classification from the architecture baseline (informational). */
export const KERNEL_RING = "core" as const;

// ── K0 · nominal aliases + branded types ──────────────────────────────────────
export type {
  CapabilityId,
  Duration,
  HandoffId,
  Iso8601,
  OpaqueToken,
  RecipientRef,
  Ref,
  RouteId,
  SessionId,
  TaskId,
} from "./brands.js";

// ── K1 · error & exit-code taxonomy ───────────────────────────────────────────
export {
  DEFAULT_RECOVERY_SKILL,
  EXIT_CODE_BY_ERROR,
  ExitCode,
  exitCodeFor,
  glaError,
  GlaErrorException,
  isGlaError,
} from "./errors.js";
export type { ErrorCode, GlaError } from "./errors.js";

// ── K2 · caveat algebra + attenuation predicate ───────────────────────────────
export { caveatsSubsetOf, isCidrWithin, isPathWithin } from "./caveats.js";
export type { Caveat, CaveatKind } from "./caveats.js";

// ── K3 · capability entity + port (signing-independent) + reference HMAC signer ─
export { InMemoryRevocations } from "./capability.js";
export type {
  Capability,
  CapabilityClass,
  CapabilityPort,
  RevocationSnapshot,
  VerifyContext,
  VerifyResult,
} from "./capability.js";
export { HmacCapabilitySigner } from "./hmac-signer.js";

// ── K4 · typed config_schema vocabulary + validator ───────────────────────────
export {
  configDefectsToError,
  validateConfig,
  validateSchemaShape,
} from "./config-schema.js";
export type {
  ConfigDefect,
  ConfigField,
  ConfigSchema,
  ConfigType,
  ConfigValidation,
} from "./config-schema.js";

// ── K5 · AssemblySpec + Mount + Resolved + offline validator ───────────────────
export { assemblyDefectsToError, validateAssembly } from "./assembly.js";
export type {
  AssemblyDefect,
  AssemblySpec,
  AssemblyValidation,
  MountSpec,
  PartRef,
  ResolvedAssemblySpec,
} from "./assembly.js";

// ── K6 · core entity types ────────────────────────────────────────────────────
export type {
  AuditActor,
  AuditEvent,
  CompletionEnvelope,
  HandoffState,
  HandoffWindow,
  Route,
  RuntimeHandle,
  Session,
  SessionState,
  Task,
  TaskState,
} from "./entities.js";

// ── K7 · module ports + identity/enrollment types ─────────────────────────────
export type {
  AgentConnector,
  AgentConnectorPort,
  AuthChallenge,
  AuthProviderPort,
  AuthStrength,
  CatalogEntity,
  CatalogPort,
  ChannelPort,
  CompletionDetectorPort,
  EnrollmentChallenge,
  HumanEntrypointPort,
  IdentityPort,
  InjectionTarget,
  LauncherPort,
  MountCapability,
  PolicyContext,
  PolicyPort,
  RawCompletionSignal,
  RecipientBinding,
  SecretStorePort,
  SecretValue,
  TemplateDescriptor,
  UserIdentity,
  WorkspaceHandle,
  WorkspacePort,
} from "./ports.js";

// ── K8 · state-transition functions (pure reducers per lifecycle) ──────────────
export {
  assertCompletionInContract,
  canHandoffTransition,
  canSessionTransition,
  canTaskTransition,
  HANDOFF_TERMINAL,
  handoffTransition,
  invalidTransition,
  isCompletionInContract,
  SESSION_TERMINAL,
  sessionTransition,
  TASK_TERMINAL,
  taskTransition,
} from "./state-machines.js";
