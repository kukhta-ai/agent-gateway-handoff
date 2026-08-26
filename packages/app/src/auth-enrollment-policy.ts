import {
  type AuthAssuranceLevel,
  type AuthAssuranceProfile,
  type AuthStrength,
  DEFAULT_AUTH_ASSURANCE_PROFILE,
  isRedactionOrTemplatePlaceholder,
  redactOperatorText,
} from "@gla/kernel";
import type { AuthProviderKind } from "./index.js";

/** A provider-owned credential/setup method declared by deployment or installer verification. */
export interface EnrollmentCredentialSetup {
  /** Provider-local method id, e.g. `password`, `webauthn-passkey`, `totp`, or a future provider's name. */
  method: string;
  /** Optional provider stage/object name that exposes this method. */
  stage?: string;
  /** Human label shown in diagnostics. */
  label?: string;
  /** Compatibility projection into GLA's legacy auth-strength fact. */
  authStrength: AuthStrength;
  /** Provider-neutral assurance level this method can produce when the provider reports matching evidence. */
  assuranceLevel: AuthAssuranceLevel;
  /** Whether the configured provider flow requires this method. */
  required?: boolean;
  /** Optional choice group id when the recipient chooses among configured alternatives. */
  choiceGroup?: string;
  /** Sanitized provider-local evidence names, never used directly for enforcement. */
  providerEvidence?: Record<string, unknown>;
}

/** An external browser source embedded in the provider's enrollment/authentication flow. */
export interface EnrollmentExternalSource {
  /** Source kind, e.g. `oauth`, `saml`, or a future browser source kind. */
  kind: string;
  /** Operator-visible source name. */
  name: string;
  /** Optional provider source object id/name. */
  source?: string;
  /** Whether this source is required by the configured flow. */
  required?: boolean;
  /** Optional choice group id when the recipient chooses among configured alternatives. */
  choiceGroup?: string;
  /** Assurance level only when provider evidence/mapping explicitly proves it; defaults to password-level. */
  assuranceLevel?: AuthAssuranceLevel;
  /** Sanitized source evidence names, never raw credentials or tokens. */
  providerEvidence?: Record<string, unknown>;
}

/** MFA/recovery factors that authentik or another provider can report as evidence without widening GLA policy. */
export interface EnrollmentMfaRecoveryMethod {
  /** Provider-local factor id, e.g. `totp`, `email-otp`, `sms-otp`, `static`, `duo`. */
  method: string;
  /** Optional provider stage/object name. */
  stage?: string;
  /** Provider-local purpose label. */
  purpose: string;
  /** Whether the provider flow requires this factor. */
  required?: boolean;
  /** Optional choice group id when the recipient chooses among configured alternatives. */
  choiceGroup?: string;
  /** Sanitized provider-local evidence names, mapped through the assurance layer by adapters/diagnostics. */
  providerEvidence?: Record<string, unknown>;
}

/** A recipient-choice set configured by the provider operator, not invented by the recipient. */
export interface EnrollmentChoiceGroup {
  /** Stable operator-facing choice-group id. */
  id: string;
  /** Method/source ids available in this group. */
  choices: string[];
  /** Whether satisfying this group is required by the provider flow. */
  required?: boolean;
}

/** Observable deployment proof status for an authentik/provider-hosted login choice. */
export type AuthLoginMethodProofStatus = "verified" | "degraded" | "unavailable" | "deferred";

/** Sanitized proof that a deployed provider exposes a login choice and emits mappable evidence. */
export interface AuthLoginMethodProof {
  /** Method/source id this proof describes, e.g. `password`, `webauthn-passkey`, or `oauth:github`. */
  method: string;
  /** Open provider-local kind, e.g. `password`, `webauthn-passkey`, `external-source`, or future kinds. */
  kind?: string;
  /** Human label shown in diagnostics. */
  label?: string;
  /** Provider flow/stage/object observed for this method. */
  stage?: string;
  /** Provider source id/name for external/social/enterprise choices. */
  source?: string;
  /** Whether this proof was observed live, degraded, unavailable, or intentionally deferred. */
  status: AuthLoginMethodProofStatus;
  /** Compatibility strength observed from the provider evidence, when available. */
  authStrength?: AuthStrength;
  /** Provider-neutral assurance level observed through the GLA mapping, when available. */
  assuranceLevel?: AuthAssuranceLevel;
  /** Redacted timestamp or run id showing proof freshness. */
  observedAt?: string;
  /** Whether enroll-then-verify proved a stable subject for source-backed login. */
  subjectStable?: boolean;
  /** Sanitized provider-local evidence names/booleans; never raw tokens, codes, secrets, or grants. */
  evidence?: Record<string, unknown>;
  /** Redacted operator-facing diagnostics from the verification/probe. */
  diagnostics?: string[];
}

/** Provider-extensible deployment-role evidence for operator diagnostics. */
export interface AuthDeploymentRole {
  /** Open role string, e.g. `authentik-forward-auth`, `gla-oidc-provider`, or future provider roles. */
  role: string;
  /** Optional provider name associated with this role. */
  provider?: string;
  /** Optional mode, e.g. `forward-auth`, `proxy`, `oidc-provider`. */
  mode?: string;
  /** Human label for diagnostics. */
  label?: string;
  /** Owner of this role, if known from deployment receipts. */
  owner?: string;
  /** Public surface/orientation this role protects or serves. */
  publicSurface?: string;
  /** Whether this role is optional defense-in-depth rather than a required GLA auth dependency. */
  optional?: boolean;
  /** Sanitized provider-local evidence names, never raw credentials or tokens. */
  providerEvidence?: Record<string, unknown>;
}

/**
 * Provider-extensible declaration of the active enrollment method policy. It is deployment evidence: GLA uses it
 * for operator diagnostics and installer/doctor checks, while runtime enforcement still reads provider facts.
 */
export interface AuthEnrollmentMethodPolicy {
  /** Provider this policy describes. Future providers may use values beyond today's app enum. */
  provider: string;
  /** Has the installer/operator declared and verified this policy, or is this only a safe default/unknown view? */
  declared: boolean;
  /** Authentik/enrollment-provider flow name or slug. */
  enrollmentFlow?: string;
  /** Provider authentication flow used after enrollment. */
  authenticationFlow?: string;
  /** Invitation stage/object that gates recipient-owned enrollment. */
  invitationStage?: string;
  /** User-write/create stage/object, when the provider creates users during enrollment. */
  userWriteStage?: string;
  /** User-login stage/object, when the provider signs the recipient in after enrollment. */
  userLoginStage?: string;
  /** Credential setup methods configured in the enrollment/authentication flow. */
  credentialSetupStages: EnrollmentCredentialSetup[];
  /** External OAuth/SAML/browser sources configured for enrollment/linking. */
  externalSources: EnrollmentExternalSource[];
  /** MFA/recovery factors configured by the provider; these are evidence, not automatic stronger GLA auth. */
  mfaRecoveryMethods: EnrollmentMfaRecoveryMethod[];
  /** Required method/source ids according to the provider flow. */
  requiredMethods: string[];
  /** Optional recipient choices, limited to the operator-configured choices in this policy. */
  optionalRecipientChoices: EnrollmentChoiceGroup[];
  /** Observed deployed login choices and emitted evidence from WPM/doctor verification. */
  loginMethodProofs?: AuthLoginMethodProof[];
  /** Deployment-role evidence from installer/operator receipts. */
  deploymentRoles?: AuthDeploymentRole[];
  /** Operator notes from installer verification. */
  notes?: string[];
}

/** Redacted deployment-role diagnostic with recognized semantics for known authentik roles. */
export interface AuthDeploymentRoleDiagnostic {
  role: string;
  provider?: string;
  mode?: string;
  label?: string;
  owner?: string;
  publicSurface?: string;
  optional: boolean;
  providerEvidence?: Record<string, unknown>;
  /** Open diagnostic string: known roles are recognized, future roles remain `other` until taught. */
  recognizedRole: string;
  /** Operator-facing authorization meaning; this is diagnostic orientation, not enforcement state. */
  authorization: string;
  /** Short explanation of what this role does and does not authorize. */
  note: string;
}

/** Operator-visible edge-guard summary for deployment-shape mistakes. */
export interface AuthEdgeGuardDiagnostic {
  summary: string;
  outerGuards: AuthDeploymentRoleDiagnostic[];
  glaOidcProvider: string;
  authorizationSemantics: string;
}

/** Operator-visible diagnostic read model for the active auth/enrollment configuration. */
export interface AuthDiagnostics {
  authProvider: AuthProviderKind;
  authAssuranceProfile: AuthAssuranceProfile;
  enrollmentPolicy: AuthEnrollmentMethodPolicy;
  deploymentRoles: AuthDeploymentRoleDiagnostic[];
  edgeGuard: AuthEdgeGuardDiagnostic;
  recipientBinding?: AuthRecipientBindingDiagnostic;
  summary: string;
  concerns: string[];
  actions: string[];
  bindingSemantics: {
    providerAccount: string;
    glaBinding: string;
  };
}

/** Recipient-scoped GLA enrollment fact, deliberately separate from provider-local account existence. */
export interface AuthRecipientBindingDiagnostic {
  /** Channel recipient ref the operator asked about. */
  recipient: string;
  /** Whether GLA has an enrollment record for this recipient. */
  glaEnrolled: boolean;
  /** Stable GLA user id, present only when a GLA enrollment record exists. */
  userId?: string;
  /** Recorded provider-neutral strength; `none` when no GLA binding exists. */
  authStrength: AuthStrength;
  /** Recorded provider-neutral assurance level, when the provider supplied it. */
  assuranceLevel?: AuthAssuranceLevel;
  /** Whether a provider credential/subject binding is present in GLA without exposing its raw id. */
  subjectBinding: "present" | "absent";
  /** Provider-local account state is intentionally not treated as a GLA binding. */
  providerAccount: string;
  /** Whether this recipient has the GLA-side prerequisite for later handoff step-up. */
  handoffPrecondition: "satisfied" | "missing-gla-binding";
}

export interface AuthRecipientEnrollmentRecord {
  userId: string;
  authStrength: AuthStrength;
  authAssurance?: { level?: AuthAssuranceLevel };
}

type PlainObject = Record<string, unknown>;

const LEVEL_RANK: Record<AuthAssuranceLevel, number> = {
  none: 0,
  password: 1,
  "phishing-resistant": 2,
};

/** Build the built-in policy view for the default in-tree WebAuthn provider. */
export function defaultWebauthnEnrollmentPolicy(): AuthEnrollmentMethodPolicy {
  return {
    provider: "webauthn",
    declared: true,
    enrollmentFlow: "gla-in-page-webauthn-registration",
    authenticationFlow: "gla-in-page-webauthn-assertion",
    credentialSetupStages: [
      {
        method: "webauthn-passkey",
        stage: "@gla/auth-webauthn",
        label: "GLA in-tree passkey registration",
        authStrength: "webauthn",
        assuranceLevel: "phishing-resistant",
        required: true,
        providerEvidence: {
          adapter: "@gla/auth-webauthn",
          userVerified: true,
          recipientBound: true,
          replayResistant: true,
        },
      },
    ],
    externalSources: [],
    mfaRecoveryMethods: [],
    requiredMethods: ["webauthn-passkey"],
    optionalRecipientChoices: [],
    notes: ["Default provider: GLA owns only passkey public-key material, never a password."],
  };
}

/** Build a safe unknown policy view for delegated providers when the installer has not declared details yet. */
export function undeclaredDelegatedEnrollmentPolicy(
  provider: AuthProviderKind,
): AuthEnrollmentMethodPolicy {
  return {
    provider,
    declared: false,
    credentialSetupStages: [],
    externalSources: [],
    mfaRecoveryMethods: [],
    requiredMethods: [],
    optionalRecipientChoices: [],
    notes: [
      "No provider enrollment method policy was declared; runtime can still redirect, but operator diagnostics cannot prove the configured methods.",
    ],
  };
}

/** Parse a JSON deployment policy descriptor from env/WPM receipt data. */
export function parseAuthEnrollmentPolicyJson(
  json: string,
  expectedProvider: AuthProviderKind,
): AuthEnrollmentMethodPolicy {
  rejectPlaceholders("auth enrollment policy", json);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("auth enrollment policy JSON is not valid JSON");
  }
  rejectPlaceholders("auth enrollment policy", value);
  const obj = objectValue(value, "auth enrollment policy");
  const policy: AuthEnrollmentMethodPolicy = {
    provider: stringValue(obj, "provider") ?? expectedProvider,
    declared: booleanValue(obj, "declared") ?? true,
    credentialSetupStages: arrayValue(obj, "credentialSetupStages").map((item, i) =>
      credentialSetupValue(item, `credentialSetupStages[${i}]`),
    ),
    externalSources: arrayValue(obj, "externalSources").map((item, i) =>
      externalSourceValue(item, `externalSources[${i}]`),
    ),
    mfaRecoveryMethods: arrayValue(obj, "mfaRecoveryMethods").map((item, i) =>
      mfaRecoveryValue(item, `mfaRecoveryMethods[${i}]`),
    ),
    requiredMethods: stringArrayValue(obj, "requiredMethods"),
    optionalRecipientChoices: arrayValue(obj, "optionalRecipientChoices").map((item, i) =>
      choiceGroupValue(item, `optionalRecipientChoices[${i}]`),
    ),
  };
  assignOptional(policy, "enrollmentFlow", stringValue(obj, "enrollmentFlow"));
  assignOptional(policy, "authenticationFlow", stringValue(obj, "authenticationFlow"));
  assignOptional(policy, "invitationStage", stringValue(obj, "invitationStage"));
  assignOptional(policy, "userWriteStage", stringValue(obj, "userWriteStage"));
  assignOptional(policy, "userLoginStage", stringValue(obj, "userLoginStage"));
  const notes = stringArrayValue(obj, "notes");
  if (notes.length > 0) {
    policy.notes = notes;
  }
  const deploymentRoles = arrayValue(obj, "deploymentRoles").map((item, i) =>
    deploymentRoleValue(item, `deploymentRoles[${i}]`),
  );
  if (deploymentRoles.length > 0) {
    policy.deploymentRoles = deploymentRoles;
  }
  const loginMethodProofs = arrayValue(obj, "loginMethodProofs").map((item, i) =>
    loginMethodProofValue(item, `loginMethodProofs[${i}]`),
  );
  if (loginMethodProofs.length > 0) {
    policy.loginMethodProofs = loginMethodProofs;
  }
  return policy;
}

/** Parse JSON deployment-role evidence from env/WPM receipt data. */
export function parseAuthDeploymentRolesJson(json: string): AuthDeploymentRole[] {
  rejectPlaceholders("auth deployment roles", json);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("auth deployment roles JSON is not valid JSON");
  }
  rejectPlaceholders("auth deployment roles", value);
  if (Array.isArray(value)) {
    return value.map((item, i) => deploymentRoleValue(item, `auth deployment roles[${i}]`));
  }
  const obj = objectValue(value, "auth deployment roles");
  if (typeof obj.role === "string") {
    return [deploymentRoleValue(obj, "auth deployment roles")];
  }
  return arrayValue(obj, "deploymentRoles").map((item, i) =>
    deploymentRoleValue(item, `deploymentRoles[${i}]`),
  );
}

/** Produce the operator diagnostic for auth provider, enrollment policy, and selected assurance profile. */
export function authEnrollmentDiagnostics(opts: {
  authProvider?: AuthProviderKind;
  authAssuranceProfile?: AuthAssuranceProfile;
  enrollmentPolicy?: AuthEnrollmentMethodPolicy;
  deploymentRoles?: AuthDeploymentRole[];
}): AuthDiagnostics {
  const authProvider = opts.authProvider ?? "webauthn";
  const authAssuranceProfile = opts.authAssuranceProfile ?? DEFAULT_AUTH_ASSURANCE_PROFILE;
  const enrollmentPolicy =
    opts.enrollmentPolicy ??
    (authProvider === "webauthn"
      ? defaultWebauthnEnrollmentPolicy()
      : undeclaredDelegatedEnrollmentPolicy(authProvider));
  const deploymentRoles = opts.deploymentRoles ?? enrollmentPolicy.deploymentRoles ?? [];
  const deploymentRoleDiagnostics = deploymentRoles.map(deploymentRoleDiagnostic);
  const edgeGuard = edgeGuardDiagnostic(deploymentRoleDiagnostics, authProvider);
  const concerns: string[] = [];
  const actions: string[] = [];

  if (enrollmentPolicy.provider !== authProvider) {
    concerns.push(
      `enrollment policy provider "${enrollmentPolicy.provider}" does not match selected provider "${authProvider}"`,
    );
    actions.push(
      "Regenerate the enrollment policy descriptor from the active identity-provider binding.",
    );
  }

  if (!enrollmentPolicy.declared) {
    concerns.push("active enrollment method policy is not declared by installer/operator evidence");
    actions.push(
      "Set GLA_AUTH_ENROLLMENT_POLICY_JSON from the identity-provider bundle's verified flow descriptor before relying on delegated enrollment.",
    );
  }

  if (authProvider === "authentik") {
    if (!enrollmentPolicy.enrollmentFlow) {
      concerns.push("authentik enrollment flow is not declared");
    }
    if (!enrollmentPolicy.invitationStage) {
      concerns.push("authentik invitation stage is not declared; invite gating cannot be audited");
    }
    if (!enrollmentPolicy.userWriteStage) {
      concerns.push(
        "authentik user-write/create stage is not declared; recipient-owned account setup cannot be audited",
      );
    }
    if (
      enrollmentPolicy.credentialSetupStages.length === 0 &&
      enrollmentPolicy.externalSources.length === 0
    ) {
      concerns.push("no authentik credential setup stage or external source is declared");
    }
    const methodProofDiagnostics = deployedLoginMethodProofDiagnostics(
      enrollmentPolicy,
      authAssuranceProfile,
    );
    concerns.push(...methodProofDiagnostics.concerns);
    actions.push(...methodProofDiagnostics.actions);
  }

  for (const choice of unsupportedConfiguredChoices(enrollmentPolicy)) {
    concerns.push(
      `optional recipient choice "${choice}" is not backed by a declared credential setup stage, external source, or MFA/recovery method`,
    );
    actions.push(
      "Regenerate the enrollment policy descriptor from the verified authentik flow so only operator-configured methods are advertised.",
    );
  }

  for (const method of unsupportedRequiredMethods(enrollmentPolicy)) {
    concerns.push(
      `required enrollment method "${method}" is not declared as a configured provider method`,
    );
    actions.push(
      "Fix the enrollment policy descriptor so required methods name configured credential, source, or MFA/recovery entries.",
    );
  }

  for (const stage of overstatedCredentialStages(enrollmentPolicy)) {
    concerns.push(
      `credential setup method "${stage.method}" overstates ${stage.assuranceLevel} assurance for reported ${stage.authStrength} strength`,
    );
    actions.push(
      `Fix provider evidence for "${stage.method}" or lower its declared assurance to match ${stage.authStrength} strength.`,
    );
  }

  for (const stage of phishingResistantStagesMissingProof(enrollmentPolicy)) {
    concerns.push(
      `credential setup method "${stage.method}" claims phishing-resistant assurance without explicit user-verification, recipient-binding, and replay-resistant evidence`,
    );
    actions.push(
      `Configure and verify "${stage.method}" to emit provider-neutral UV/binding/replay proof, or lower it to password-grade assurance.`,
    );
  }

  for (const source of sourceClaimsWithoutEvidence(enrollmentPolicy)) {
    concerns.push(
      `external source "${source.kind}:${source.name}" claims phishing-resistant assurance without explicit provider evidence`,
    );
    actions.push(
      `Add verified source evidence for "${source.kind}:${source.name}" or lower the source assurance declaration.`,
    );
  }

  if (!policyCanSatisfyAssurance(enrollmentPolicy, authAssuranceProfile)) {
    concerns.push(
      `declared enrollment/login methods do not prove they can satisfy ${authAssuranceProfile} assurance`,
    );
    actions.push(
      authAssuranceProfile === "phishing-resistant"
        ? "Add/verify a WebAuthn/passkey or equivalent phishing-resistant provider evidence path, or intentionally switch to password-permitted."
        : "Add/verify at least one password-or-stronger credential/source path before issuing invites.",
    );
  }

  const mfaOnly = enrollmentPolicy.mfaRecoveryMethods.filter(
    (m) => !methodListedAsPrimary(enrollmentPolicy, m.method),
  );
  if (mfaOnly.length > 0) {
    actions.push(
      "Treat configured MFA/recovery factors as provider evidence mapped through the assurance policy; do not count them as passkey-grade by default.",
    );
  }

  const authentikOuterGuards = deploymentRoleDiagnostics.filter(isAuthentikOuterGuardDiagnostic);
  if (authentikOuterGuards.length > 0 && authProvider !== "authentik") {
    concerns.push(
      `authentik proxy/forward-auth is declared as an optional outer proxy, but selected auth provider "${authProvider}" means the outer proxy does not perform GLA handoff step-up`,
    );
    actions.push(
      "Set GLA_AUTH_PROVIDER=authentik with GLA_AUTHENTIK_ISSUER_URL, GLA_AUTHENTIK_CLIENT_ID, GLA_AUTHENTIK_CLIENT_SECRET, and GLA_AUTHENTIK_REDIRECT_URI for delegated OIDC/callback step-up, or intentionally keep WebAuthn and treat authentik proxy/forward-auth as defense-in-depth only.",
    );
  }
  if (authentikOuterGuards.length > 0 && authProvider === "authentik") {
    actions.push(
      "GLA still verifies handoff/enrollment grants through the Access Gateway; proxy session alone cannot bypass GLA Access Gateway authorization.",
    );
  }

  if (actions.length === 0) {
    actions.push("No immediate auth enrollment action required by the declared policy.");
  }

  return {
    authProvider,
    authAssuranceProfile,
    enrollmentPolicy: redactEnrollmentPolicy(enrollmentPolicy),
    deploymentRoles: deploymentRoleDiagnostics,
    edgeGuard,
    summary: safeText(summarizePolicy(enrollmentPolicy, authAssuranceProfile, deploymentRoles)),
    concerns: concerns.map(safeText),
    actions: actions.map(safeText),
    bindingSemantics: {
      providerAccount:
        authProvider === "authentik"
          ? "An authentik account or successful authentik login is provider-local state; it is not a GLA enrollment by itself."
          : "The in-tree WebAuthn provider has no separate account store.",
      glaBinding:
        "A recipient is GLA-enrolled only after an invite-backed provider round trip records an IdentityService EnrollmentRecord and the provider binding used for later step-up.",
    },
  };
}

/** Add a recipient-scoped GLA binding diagnostic without querying or trusting provider-local account state. */
export function withRecipientBindingDiagnostic(
  diagnostics: AuthDiagnostics,
  recipient: string,
  record: AuthRecipientEnrollmentRecord | undefined,
): AuthDiagnostics {
  const recipientBinding: AuthRecipientBindingDiagnostic =
    record === undefined
      ? {
          recipient: safeText(recipient),
          glaEnrolled: false,
          authStrength: "none",
          subjectBinding: "absent",
          providerAccount:
            "Not inspected by GLA; a provider-local account or login does not make this recipient enrolled.",
          handoffPrecondition: "missing-gla-binding",
        }
      : recipientBindingFromRecord(recipient, record);
  return {
    ...diagnostics,
    recipientBinding,
  };
}

function recipientBindingFromRecord(
  recipient: string,
  record: AuthRecipientEnrollmentRecord,
): AuthRecipientBindingDiagnostic {
  const binding: AuthRecipientBindingDiagnostic = {
    recipient: safeText(recipient),
    glaEnrolled: true,
    userId: safeText(record.userId),
    authStrength: record.authStrength,
    subjectBinding: "present",
    providerAccount:
      "Provider-local account existence is separate; this diagnostic reports the GLA enrollment binding used for handoff.",
    handoffPrecondition: "satisfied",
  };
  const level = record.authAssurance?.level;
  if (level === "none" || level === "password" || level === "phishing-resistant") {
    binding.assuranceLevel = level;
  }
  return binding;
}

function summarizePolicy(
  policy: AuthEnrollmentMethodPolicy,
  profile: AuthAssuranceProfile,
  deploymentRoles: AuthDeploymentRole[] = policy.deploymentRoles ?? [],
): string {
  const credentials = policy.credentialSetupStages.map((s) => s.method);
  const sources = policy.externalSources.map((s) => `${s.kind}:${s.name}`);
  const choices = policy.optionalRecipientChoices.map((g) => `${g.id}=[${g.choices.join("|")}]`);
  const roles = deploymentRoles.map((r) => r.role);
  const proofs = policy.loginMethodProofs?.map((p) => `${p.method}:${p.status}`) ?? [];
  return [
    `${policy.provider} enrollment policy ${policy.declared ? "declared" : "undeclared"}`,
    `assurance=${profile}`,
    `flow=${policy.enrollmentFlow ?? "unknown"}`,
    `credentials=${credentials.length > 0 ? credentials.join(",") : "none"}`,
    `sources=${sources.length > 0 ? sources.join(",") : "none"}`,
    `choices=${choices.length > 0 ? choices.join(",") : "none"}`,
    `loginMethodProofs=${proofs.length > 0 ? proofs.join(",") : "none"}`,
    `deploymentRoles=${roles.length > 0 ? roles.join(",") : "none"}`,
  ].join("; ");
}

function policyCanSatisfyAssurance(
  policy: AuthEnrollmentMethodPolicy,
  profile: AuthAssuranceProfile,
): boolean {
  const levels: AuthAssuranceLevel[] = [
    ...policy.credentialSetupStages.map(effectiveCredentialAssuranceLevel),
    ...policy.externalSources.map(effectiveSourceAssuranceLevel),
  ];
  const required: AuthAssuranceLevel =
    profile === "phishing-resistant" ? "phishing-resistant" : "password";
  return levels.some((level) => LEVEL_RANK[level] >= LEVEL_RANK[required]);
}

function deployedLoginMethodProofDiagnostics(
  policy: AuthEnrollmentMethodPolicy,
  profile: AuthAssuranceProfile,
): { concerns: string[]; actions: string[] } {
  const concerns: string[] = [];
  const actions: string[] = [];
  const proofs = policy.loginMethodProofs ?? [];
  if (proofs.length === 0) {
    concerns.push(
      "authentik deployed login-method proof is not declared; visible password/passkey/source choices and emitted evidence are unverified",
    );
    actions.push(
      "Run the identity-provider verification/doctor against the deployed authentik application and record loginMethodProofs for password, passkey/WebAuthn, and configured sources.",
    );
    return { concerns, actions };
  }

  for (const proof of proofs) {
    if (proof.status !== "verified") {
      concerns.push(
        `deployed authentik login method "${proof.method}" proof is ${proof.status}, not verified`,
      );
      actions.push(
        `Re-run or complete deployed authentik verification for "${proof.method}" before treating that login choice as available.`,
      );
    }
    if (proof.status === "verified" && !proofHasAssuranceMapping(proof)) {
      concerns.push(
        `deployed authentik login method "${proof.method}" proof lacks GLA assurance mapping`,
      );
      actions.push(
        `Record authStrength and assuranceLevel for "${proof.method}" from the provider evidence before treating that proof as available.`,
      );
    }
    if (proof.status === "verified" && proofOverstatesAssurance(proof)) {
      concerns.push(
        `deployed authentik login method "${proof.method}" proof overstates ${proof.assuranceLevel} assurance for reported ${proof.authStrength} strength`,
      );
      actions.push(
        `Fix provider evidence for "${proof.method}" or lower its proof assurance to match ${proof.authStrength} strength.`,
      );
    }
    if (
      proof.status === "verified" &&
      proof.assuranceLevel === "phishing-resistant" &&
      !proofHasPhishingEvidence(proof)
    ) {
      concerns.push(
        `deployed authentik login method "${proof.method}" proof claims phishing-resistant assurance without UV, recipient-binding, and replay-resistant evidence`,
      );
      actions.push(
        `Record UV/binding/replay proof for "${proof.method}" or lower it to password-grade assurance.`,
      );
    }
    if (proof.status === "verified" && !proofHasEmittedEvidence(proof)) {
      concerns.push(
        `deployed authentik login method "${proof.method}" proof lacks emitted provider evidence`,
      );
      actions.push(
        `Record redacted emitted evidence for "${proof.method}" such as safe claim labels, UV proof, or source identifiers; never infer availability from status alone.`,
      );
    }
    for (const diagnostic of proof.diagnostics ?? []) {
      concerns.push(`deployed authentik login method "${proof.method}" reports ${diagnostic}`);
    }
  }

  const passwordStages = policy.credentialSetupStages.filter(isPasswordCredentialStage);
  if (
    passwordStages.length > 0 &&
    !hasVerifiedPasswordProofForAny(proofs, passwordStages.flatMap(credentialStageIds))
  ) {
    concerns.push(
      "authentik password fallback is declared but no verified deployed password login proof was recorded",
    );
    actions.push(
      "Verify the authentik password path is visible and emits password-grade evidence before relying on password-permitted handoff.",
    );
  }

  const passkeyStages = policy.credentialSetupStages.filter(isPasskeyCredentialStage);
  const verifiedPasskey = proofs.find(
    (proof) =>
      proof.status === "verified" &&
      passkeyStages.some((stage) => proofMatchesIds(proof, credentialStageIds(stage))) &&
      proof.authStrength === "webauthn" &&
      proof.assuranceLevel === "phishing-resistant" &&
      proofHasPhishingEvidence(proof),
  );
  if (passkeyStages.length > 0 && verifiedPasskey === undefined) {
    concerns.push(
      "authentik passkey/WebAuthn path is declared but no verified deployed proof shows UV-backed phishing-resistant evidence",
    );
    actions.push(
      "Verify a deployed passkey/WebAuthn login for an enrolled compatible authenticator and record amr/acr plus gla_uv/userVerified, recipient binding, and replay-resistant evidence.",
    );
  }
  if (
    profile === "phishing-resistant" &&
    passkeyStages.length > 0 &&
    verifiedPasskey === undefined
  ) {
    concerns.push(
      "selected phishing-resistant policy cannot be proven from deployed authentik login-method proof; recipients may see only password-grade choices",
    );
    actions.push(
      "Fix the authentik Identification/WebAuthn flow or switch intentionally to password-permitted until passkey UV proof is verified.",
    );
  }

  for (const source of policy.externalSources) {
    const sourceProofs = proofs.filter((proof) =>
      proofMatchesIds(proof, externalSourceIds(source)),
    );
    const verifiedSource = sourceProofs.find(
      (proof) =>
        proof.status === "verified" &&
        proofHasAssuranceMapping(proof) &&
        proofHasEmittedEvidence(proof),
    );
    if (verifiedSource === undefined) {
      concerns.push(
        `external source "${source.kind}:${source.name}" is declared but no verified deployed source login proof was recorded`,
      );
      actions.push(
        `Verify "${source.kind}:${source.name}" appears as an authentik login choice and returns stable subject evidence before advertising it as available.`,
      );
      continue;
    }
    if (verifiedSource.subjectStable !== true) {
      concerns.push(
        `external source "${source.kind}:${source.name}" proof does not show stable subject evidence for enroll-then-verify`,
      );
      actions.push(
        `Record stable subject proof for "${source.kind}:${source.name}" or treat the source as unavailable for GLA enrollment/handoff.`,
      );
    }
  }

  return { concerns, actions };
}

function isPasswordCredentialStage(stage: EnrollmentCredentialSetup): boolean {
  return stage.authStrength === "password" || /password|pwd/i.test(stage.method);
}

function isPasskeyCredentialStage(stage: EnrollmentCredentialSetup): boolean {
  return (
    stage.authStrength === "webauthn" ||
    stage.assuranceLevel === "phishing-resistant" ||
    /webauthn|passkey|fido/i.test([stage.method, stage.stage, stage.label].join(" "))
  );
}

function credentialStageIds(stage: EnrollmentCredentialSetup): string[] {
  return [stage.method, stage.stage, stage.label].filter((v): v is string => v !== undefined);
}

function externalSourceIds(source: EnrollmentExternalSource): string[] {
  return [`${source.kind}:${source.name}`, source.name, source.source].filter(
    (v): v is string => v !== undefined,
  );
}

function hasVerifiedPasswordProofForAny(proofs: AuthLoginMethodProof[], ids: string[]): boolean {
  return proofs.some(
    (proof) =>
      proof.status === "verified" &&
      proof.authStrength === "password" &&
      proof.assuranceLevel === "password" &&
      proofHasEmittedEvidence(proof) &&
      ids.some((id) => proofMatchesIds(proof, [id])),
  );
}

function proofMatchesIds(proof: AuthLoginMethodProof, ids: string[]): boolean {
  const proofIds = [proof.method, proof.kind, proof.stage, proof.source, proof.label]
    .filter((v): v is string => v !== undefined)
    .map((v) => v.toLowerCase());
  return ids.some((id) => proofIds.includes(id.toLowerCase()));
}

function proofHasPhishingEvidence(proof: AuthLoginMethodProof): boolean {
  const evidence = proof.evidence;
  return (
    (evidence?.gla_uv === true || evidence?.userVerified === true) &&
    evidence.recipientBound === true &&
    evidence.replayResistant === true
  );
}

function proofHasAssuranceMapping(proof: AuthLoginMethodProof): boolean {
  return proof.authStrength !== undefined && proof.assuranceLevel !== undefined;
}

function proofOverstatesAssurance(proof: AuthLoginMethodProof): boolean {
  const { authStrength, assuranceLevel } = proof;
  if (authStrength === undefined || assuranceLevel === undefined) {
    return false;
  }
  return LEVEL_RANK[assuranceLevel] > LEVEL_RANK[levelFromStrength(authStrength)];
}

function proofHasEmittedEvidence(proof: AuthLoginMethodProof): boolean {
  return proof.evidence !== undefined && Object.keys(proof.evidence).length > 0;
}

function overstatedCredentialStages(
  policy: AuthEnrollmentMethodPolicy,
): EnrollmentCredentialSetup[] {
  return policy.credentialSetupStages.filter(
    (stage) => LEVEL_RANK[stage.assuranceLevel] > LEVEL_RANK[levelFromStrength(stage.authStrength)],
  );
}

function phishingResistantStagesMissingProof(
  policy: AuthEnrollmentMethodPolicy,
): EnrollmentCredentialSetup[] {
  return policy.credentialSetupStages.filter(
    (stage) =>
      stage.assuranceLevel === "phishing-resistant" && !credentialDeclaresPhishingProof(stage),
  );
}

function sourceClaimsWithoutEvidence(
  policy: AuthEnrollmentMethodPolicy,
): EnrollmentExternalSource[] {
  return policy.externalSources.filter(
    (source) =>
      source.assuranceLevel === "phishing-resistant" &&
      (source.providerEvidence === undefined || Object.keys(source.providerEvidence).length === 0),
  );
}

function effectiveCredentialAssuranceLevel(stage: EnrollmentCredentialSetup): AuthAssuranceLevel {
  const strengthLevel = levelFromStrength(stage.authStrength);
  const capped =
    LEVEL_RANK[stage.assuranceLevel] <= LEVEL_RANK[strengthLevel]
      ? stage.assuranceLevel
      : strengthLevel;
  if (capped === "phishing-resistant" && !credentialDeclaresPhishingProof(stage)) {
    return "password";
  }
  return capped;
}

function credentialDeclaresPhishingProof(stage: EnrollmentCredentialSetup): boolean {
  const evidence = stage.providerEvidence;
  return (
    evidence?.userVerified === true &&
    evidence.recipientBound === true &&
    evidence.replayResistant === true
  );
}

function effectiveSourceAssuranceLevel(source: EnrollmentExternalSource): AuthAssuranceLevel {
  if (
    source.assuranceLevel === "phishing-resistant" &&
    (source.providerEvidence === undefined || Object.keys(source.providerEvidence).length === 0)
  ) {
    return "password";
  }
  return source.assuranceLevel ?? "password";
}

function methodListedAsPrimary(policy: AuthEnrollmentMethodPolicy, method: string): boolean {
  return policy.credentialSetupStages.some((s) => s.method === method);
}

function supportedPolicyIds(policy: AuthEnrollmentMethodPolicy): Set<string> {
  const ids = new Set<string>();
  for (const stage of policy.credentialSetupStages) {
    ids.add(stage.method);
  }
  for (const source of policy.externalSources) {
    ids.add(`${source.kind}:${source.name}`);
    ids.add(source.name);
    if (source.source !== undefined) {
      ids.add(source.source);
    }
  }
  for (const method of policy.mfaRecoveryMethods) {
    ids.add(method.method);
  }
  return ids;
}

function unsupportedConfiguredChoices(policy: AuthEnrollmentMethodPolicy): string[] {
  const supported = supportedPolicyIds(policy);
  const unsupported: string[] = [];
  for (const group of policy.optionalRecipientChoices) {
    for (const choice of group.choices) {
      if (!supported.has(choice)) {
        unsupported.push(`${group.id}:${choice}`);
      }
    }
  }
  return unsupported;
}

function unsupportedRequiredMethods(policy: AuthEnrollmentMethodPolicy): string[] {
  const supported = supportedPolicyIds(policy);
  return policy.requiredMethods.filter((method) => !supported.has(method));
}

function credentialSetupValue(item: unknown, path: string): EnrollmentCredentialSetup {
  const obj = objectValue(item, path);
  const method = requiredString(obj, "method", path);
  const authStrength = authStrengthValue(obj.authStrength, `${path}.authStrength`);
  const setup: EnrollmentCredentialSetup = {
    method,
    authStrength,
    assuranceLevel:
      authAssuranceLevelValue(obj.assuranceLevel, `${path}.assuranceLevel`) ??
      levelFromStrength(authStrength),
  };
  assignOptional(setup, "stage", stringValue(obj, "stage"));
  assignOptional(setup, "label", stringValue(obj, "label"));
  assignOptional(setup, "required", booleanValue(obj, "required"));
  assignOptional(setup, "choiceGroup", stringValue(obj, "choiceGroup"));
  assignOptional(
    setup,
    "providerEvidence",
    recordValue(obj.providerEvidence, `${path}.providerEvidence`),
  );
  return setup;
}

function externalSourceValue(item: unknown, path: string): EnrollmentExternalSource {
  const obj = objectValue(item, path);
  const source: EnrollmentExternalSource = {
    kind: requiredString(obj, "kind", path),
    name: requiredString(obj, "name", path),
  };
  assignOptional(source, "source", stringValue(obj, "source"));
  assignOptional(source, "required", booleanValue(obj, "required"));
  assignOptional(source, "choiceGroup", stringValue(obj, "choiceGroup"));
  assignOptional(
    source,
    "assuranceLevel",
    authAssuranceLevelValue(obj.assuranceLevel, `${path}.assuranceLevel`),
  );
  assignOptional(
    source,
    "providerEvidence",
    recordValue(obj.providerEvidence, `${path}.providerEvidence`),
  );
  return source;
}

function mfaRecoveryValue(item: unknown, path: string): EnrollmentMfaRecoveryMethod {
  const obj = objectValue(item, path);
  const method: EnrollmentMfaRecoveryMethod = {
    method: requiredString(obj, "method", path),
    purpose: stringValue(obj, "purpose") ?? "mfa",
  };
  assignOptional(method, "stage", stringValue(obj, "stage"));
  assignOptional(method, "required", booleanValue(obj, "required"));
  assignOptional(method, "choiceGroup", stringValue(obj, "choiceGroup"));
  assignOptional(
    method,
    "providerEvidence",
    recordValue(obj.providerEvidence, `${path}.providerEvidence`),
  );
  return method;
}

function choiceGroupValue(item: unknown, path: string): EnrollmentChoiceGroup {
  const obj = objectValue(item, path);
  const group: EnrollmentChoiceGroup = {
    id: requiredString(obj, "id", path),
    choices: stringArrayValue(obj, "choices"),
  };
  assignOptional(group, "required", booleanValue(obj, "required"));
  return group;
}

function deploymentRoleValue(item: unknown, path: string): AuthDeploymentRole {
  const obj = objectValue(item, path);
  const role: AuthDeploymentRole = {
    role: requiredString(obj, "role", path),
  };
  assignOptional(role, "provider", stringValue(obj, "provider"));
  assignOptional(role, "mode", stringValue(obj, "mode"));
  assignOptional(role, "label", stringValue(obj, "label"));
  assignOptional(role, "owner", stringValue(obj, "owner"));
  assignOptional(role, "publicSurface", stringValue(obj, "publicSurface"));
  assignOptional(role, "optional", booleanValue(obj, "optional"));
  assignOptional(
    role,
    "providerEvidence",
    recordValue(obj.providerEvidence, `${path}.providerEvidence`),
  );
  return role;
}

function loginMethodProofValue(item: unknown, path: string): AuthLoginMethodProof {
  const obj = objectValue(item, path);
  const proof: AuthLoginMethodProof = {
    method: requiredString(obj, "method", path),
    status: loginMethodProofStatusValue(obj.status, `${path}.status`),
  };
  assignOptional(proof, "kind", stringValue(obj, "kind"));
  assignOptional(proof, "label", stringValue(obj, "label"));
  assignOptional(proof, "stage", stringValue(obj, "stage"));
  assignOptional(proof, "source", stringValue(obj, "source"));
  assignOptional(
    proof,
    "authStrength",
    obj.authStrength === undefined
      ? undefined
      : authStrengthValue(obj.authStrength, `${path}.authStrength`),
  );
  assignOptional(
    proof,
    "assuranceLevel",
    authAssuranceLevelValue(obj.assuranceLevel, `${path}.assuranceLevel`),
  );
  assignOptional(proof, "observedAt", stringValue(obj, "observedAt"));
  assignOptional(proof, "subjectStable", booleanValue(obj, "subjectStable"));
  assignOptional(proof, "evidence", recordValue(obj.evidence, `${path}.evidence`));
  const diagnostics = stringArrayValue(obj, "diagnostics");
  if (diagnostics.length > 0) {
    proof.diagnostics = diagnostics;
  }
  return proof;
}

function objectValue(value: unknown, path: string): PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as PlainObject;
}

function arrayValue(obj: PlainObject, key: string): unknown[] {
  const value = obj[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value;
}

function stringArrayValue(obj: PlainObject, key: string): string[] {
  return arrayValue(obj, key).map((item, i) => {
    if (typeof item !== "string") {
      throw new Error(`${key}[${i}] must be a string`);
    }
    return item;
  });
}

function stringValue(obj: PlainObject, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function requiredString(obj: PlainObject, key: string, path: string): string {
  const value = stringValue(obj, key);
  if (value === undefined || value.length === 0) {
    throw new Error(`${path}.${key} is required`);
  }
  return value;
}

function booleanValue(obj: PlainObject, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function authStrengthValue(value: unknown, path: string): AuthStrength {
  if (value === "none" || value === "password" || value === "webauthn") {
    return value;
  }
  throw new Error(`${path} must be none|password|webauthn`);
}

function authAssuranceLevelValue(value: unknown, path: string): AuthAssuranceLevel | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "none" || value === "password" || value === "phishing-resistant") {
    return value;
  }
  throw new Error(`${path} must be none|password|phishing-resistant`);
}

function loginMethodProofStatusValue(value: unknown, path: string): AuthLoginMethodProofStatus {
  if (
    value === "verified" ||
    value === "degraded" ||
    value === "unavailable" ||
    value === "deferred"
  ) {
    return value;
  }
  throw new Error(`${path} must be verified|degraded|unavailable|deferred`);
}

function levelFromStrength(strength: AuthStrength): AuthAssuranceLevel {
  switch (strength) {
    case "webauthn":
      return "phishing-resistant";
    case "password":
      return "password";
    case "none":
      return "none";
  }
}

function recordValue(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return objectValue(value, path);
}

function redactEnrollmentPolicy(policy: AuthEnrollmentMethodPolicy): AuthEnrollmentMethodPolicy {
  const redacted: AuthEnrollmentMethodPolicy = {
    provider: safeText(policy.provider),
    declared: policy.declared,
    credentialSetupStages: policy.credentialSetupStages.map(redactCredentialSetup),
    externalSources: policy.externalSources.map(redactExternalSource),
    mfaRecoveryMethods: policy.mfaRecoveryMethods.map(redactMfaRecoveryMethod),
    requiredMethods: policy.requiredMethods.map(safeText),
    optionalRecipientChoices: policy.optionalRecipientChoices.map(redactChoiceGroup),
  };
  assignOptional(redacted, "enrollmentFlow", optionalSafeText(policy.enrollmentFlow));
  assignOptional(redacted, "authenticationFlow", optionalSafeText(policy.authenticationFlow));
  assignOptional(redacted, "invitationStage", optionalSafeText(policy.invitationStage));
  assignOptional(redacted, "userWriteStage", optionalSafeText(policy.userWriteStage));
  assignOptional(redacted, "userLoginStage", optionalSafeText(policy.userLoginStage));
  const notes = policy.notes?.map(safeText);
  if (notes !== undefined && notes.length > 0) {
    redacted.notes = notes;
  }
  const deploymentRoles = policy.deploymentRoles?.map(redactDeploymentRole);
  if (deploymentRoles !== undefined && deploymentRoles.length > 0) {
    redacted.deploymentRoles = deploymentRoles;
  }
  const loginMethodProofs = policy.loginMethodProofs?.map(redactLoginMethodProof);
  if (loginMethodProofs !== undefined && loginMethodProofs.length > 0) {
    redacted.loginMethodProofs = loginMethodProofs;
  }
  return redacted;
}

function redactCredentialSetup(stage: EnrollmentCredentialSetup): EnrollmentCredentialSetup {
  const redacted: EnrollmentCredentialSetup = {
    method: safeText(stage.method),
    authStrength: stage.authStrength,
    assuranceLevel: stage.assuranceLevel,
  };
  assignOptional(redacted, "stage", optionalSafeText(stage.stage));
  assignOptional(redacted, "label", optionalSafeText(stage.label));
  assignOptional(redacted, "required", stage.required);
  assignOptional(redacted, "choiceGroup", optionalSafeText(stage.choiceGroup));
  assignOptional(redacted, "providerEvidence", redactEvidence(stage.providerEvidence));
  return redacted;
}

function redactExternalSource(source: EnrollmentExternalSource): EnrollmentExternalSource {
  const redacted: EnrollmentExternalSource = {
    kind: safeText(source.kind),
    name: safeText(source.name),
  };
  assignOptional(redacted, "source", optionalSafeText(source.source));
  assignOptional(redacted, "required", source.required);
  assignOptional(redacted, "choiceGroup", optionalSafeText(source.choiceGroup));
  assignOptional(redacted, "assuranceLevel", source.assuranceLevel);
  assignOptional(redacted, "providerEvidence", redactEvidence(source.providerEvidence));
  return redacted;
}

function redactMfaRecoveryMethod(method: EnrollmentMfaRecoveryMethod): EnrollmentMfaRecoveryMethod {
  const redacted: EnrollmentMfaRecoveryMethod = {
    method: safeText(method.method),
    purpose: safeText(method.purpose),
  };
  assignOptional(redacted, "stage", optionalSafeText(method.stage));
  assignOptional(redacted, "required", method.required);
  assignOptional(redacted, "choiceGroup", optionalSafeText(method.choiceGroup));
  assignOptional(redacted, "providerEvidence", redactEvidence(method.providerEvidence));
  return redacted;
}

function redactChoiceGroup(group: EnrollmentChoiceGroup): EnrollmentChoiceGroup {
  const redacted: EnrollmentChoiceGroup = {
    id: safeText(group.id),
    choices: group.choices.map(safeText),
  };
  assignOptional(redacted, "required", group.required);
  return redacted;
}

function redactDeploymentRole(role: AuthDeploymentRole): AuthDeploymentRole {
  const redacted: AuthDeploymentRole = {
    role: safeText(role.role),
  };
  assignOptional(redacted, "provider", optionalSafeText(role.provider));
  assignOptional(redacted, "mode", optionalSafeText(role.mode));
  assignOptional(redacted, "label", optionalSafeText(role.label));
  assignOptional(redacted, "owner", optionalSafeText(role.owner));
  assignOptional(redacted, "publicSurface", optionalSafeText(role.publicSurface));
  assignOptional(redacted, "optional", role.optional);
  assignOptional(redacted, "providerEvidence", redactEvidence(role.providerEvidence));
  return redacted;
}

function redactLoginMethodProof(proof: AuthLoginMethodProof): AuthLoginMethodProof {
  const redacted: AuthLoginMethodProof = {
    method: safeText(proof.method),
    status: proof.status,
  };
  assignOptional(redacted, "kind", optionalSafeText(proof.kind));
  assignOptional(redacted, "label", optionalSafeText(proof.label));
  assignOptional(redacted, "stage", optionalSafeText(proof.stage));
  assignOptional(redacted, "source", optionalSafeText(proof.source));
  assignOptional(redacted, "authStrength", proof.authStrength);
  assignOptional(redacted, "assuranceLevel", proof.assuranceLevel);
  assignOptional(redacted, "observedAt", optionalSafeText(proof.observedAt));
  assignOptional(redacted, "subjectStable", proof.subjectStable);
  assignOptional(redacted, "evidence", redactEvidence(proof.evidence));
  const diagnostics = proof.diagnostics?.map(safeText);
  if (diagnostics !== undefined && diagnostics.length > 0) {
    redacted.diagnostics = diagnostics;
  }
  return redacted;
}

function deploymentRoleDiagnostic(role: AuthDeploymentRole): AuthDeploymentRoleDiagnostic {
  const redacted = redactDeploymentRole(role);
  const recognizedRole = recognizedDeploymentRole(role);
  const diagnostic: AuthDeploymentRoleDiagnostic = {
    role: redacted.role,
    optional: redacted.optional ?? false,
    recognizedRole,
    authorization: deploymentRoleAuthorization(recognizedRole),
    note: deploymentRoleNote(recognizedRole),
  };
  assignOptional(diagnostic, "provider", redacted.provider);
  assignOptional(diagnostic, "mode", redacted.mode);
  assignOptional(diagnostic, "label", redacted.label);
  assignOptional(diagnostic, "owner", redacted.owner);
  assignOptional(diagnostic, "publicSurface", redacted.publicSurface);
  assignOptional(diagnostic, "providerEvidence", redacted.providerEvidence);
  return diagnostic;
}

function recognizedDeploymentRole(role: AuthDeploymentRole): string {
  const text = [role.role, role.provider, role.mode, role.label]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  const provider = role.provider?.toLowerCase();
  const authentikish = provider === "authentik" || text.includes("authentik");
  if (authentikish && /forward[-_\s]?auth|forwardauth/.test(text)) {
    return "authentik-forward-auth";
  }
  if (authentikish && /proxy|outpost/.test(text)) {
    return "authentik-proxy";
  }
  if (authentikish && /oidc|openid|auth[-_\s]?provider|step[-_\s]?up/.test(text)) {
    return "authentik-oidc-provider";
  }
  return "other";
}

function deploymentRoleAuthorization(recognizedRole: string): string {
  if (recognizedRole === "authentik-forward-auth" || recognizedRole === "authentik-proxy") {
    return "optional outer edge guard; not GLA handoff authorization";
  }
  if (recognizedRole === "authentik-oidc-provider") {
    return "delegated OIDC step-up provider when selected by GLA_AUTH_PROVIDER=authentik";
  }
  return "operator orientation only; no authorization semantics implied";
}

function deploymentRoleNote(recognizedRole: string): string {
  if (recognizedRole === "authentik-forward-auth" || recognizedRole === "authentik-proxy") {
    return "Optional outer protection only; GLA Access Gateway still enforces handoff/enrollment grants.";
  }
  if (recognizedRole === "authentik-oidc-provider") {
    return "Provider supplies OIDC step-up evidence when selected; GLA still verifies callback state and grants.";
  }
  return "Reported for deployment orientation; future role strings do not change GLA authorization by themselves.";
}

function edgeGuardDiagnostic(
  deploymentRoles: AuthDeploymentRoleDiagnostic[],
  authProvider: AuthProviderKind,
): AuthEdgeGuardDiagnostic {
  const outerGuards = deploymentRoles.filter(isAuthentikOuterGuardDiagnostic);
  const declaredOidc = deploymentRoles.some(
    (role) => role.recognizedRole === "authentik-oidc-provider",
  );
  const outerSummary =
    outerGuards.length > 0
      ? `${outerGuards.map(edgeGuardSummaryName).join(", ")} outer guard declared`
      : "no authentik outer guard declared";
  const oidcSummary =
    authProvider === "authentik"
      ? "GLA OIDC provider selected"
      : declaredOidc
        ? "GLA OIDC provider role declared but not selected"
        : "GLA OIDC provider not selected";
  return {
    summary: safeText(
      `${outerSummary}; ${oidcSummary}; GLA Access Gateway verifies handoff/enrollment grants`,
    ),
    outerGuards,
    glaOidcProvider:
      authProvider === "authentik"
        ? "selected"
        : declaredOidc
          ? "declared-not-selected"
          : "not-selected",
    authorizationSemantics:
      "authentik proxy/forward-auth can be an optional outer guard only; GLA handoff/enrollment authorization remains grant-bound inside the Access Gateway.",
  };
}

function edgeGuardSummaryName(role: AuthDeploymentRoleDiagnostic): string {
  if (role.recognizedRole === "authentik-forward-auth") {
    return "authentik forward-auth";
  }
  if (role.recognizedRole === "authentik-proxy") {
    return "authentik proxy";
  }
  return role.role;
}

function isAuthentikOuterGuardDiagnostic(role: AuthDeploymentRoleDiagnostic): boolean {
  return (
    role.recognizedRole === "authentik-forward-auth" || role.recognizedRole === "authentik-proxy"
  );
}

function assignOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function redactEvidence(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return redactEvidenceValue(value) as Record<string, unknown>;
}

function redactEvidenceValue(value: unknown): unknown {
  if (typeof value === "string") {
    return safeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactEvidenceValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = safeText(key);
      out[safeKey] = secretLikeKey(key) ? "<redacted>" : redactEvidenceValue(entry);
    }
    return out;
  }
  return value;
}

function secretLikeKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    normalized === "grant" ||
    normalized === "nonce" ||
    normalized === "codeverifier" ||
    normalized === "idtoken" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized.includes("privatekey")
  );
}

function optionalSafeText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : safeText(value);
}

function safeText(value: string): string {
  return redactOperatorText(value);
}

function rejectPlaceholders(name: string, value: unknown): void {
  if (typeof value === "string") {
    if (isRedactionOrTemplatePlaceholder(value)) {
      throw new Error(
        `${name} contains a redaction/template placeholder; provide a real value or unset it`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => rejectPlaceholders(`${name}[${i}]`, item));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      rejectPlaceholders(`${name}.${key}`, item);
    }
  }
}
