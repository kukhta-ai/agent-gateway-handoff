// Unit tests for the DELEGATED authentik AuthProvider (adapters/auth-authentik), GLA-068. They prove the
// OIDC relying-party logic + the typed-reason classification + the recipient-binding enforcement
// DETERMINISTICALLY, with NO real network: a controllable fake-authentik OIDC test double mints signed
// id_tokens and a fake token endpoint the injected `fetch` seam routes to. The full browser redirect/
// callback UX is GLA-072; here every server-side check (signature, iss, aud, exp/iat/nbf, nonce, state/
// replay, token-exchange failure, subject mismatch) and the amr/acr→strength table are pinned.
//
// Coverage map: AC#2 (challenge URL + verify happy path, fact shape) · AC#3 (every typed rejection) ·
// AC#4 (finishEnrollment binds the sub; later verify with that sub succeeds, stable; a different sub fails) ·
// AC#5 (the amr/acr mapping table) · AC#6 (default-provider wiring lives in the app test, see app/test).
// The no-half-bound + one-time-consume invariants mirror auth-webauthn's atomic tests.

import type { OpaqueToken, UserIdentity } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { FakeAuthentik } from "./fake-authentik.js";
import {
  type AuthAuthentikOptions,
  AuthAuthentikProvider,
  type AuthFailReason,
  type BoundSubject,
  InMemoryKv,
  type OidcRandomness,
  type PendingAttempt,
  type RedirectChallenge,
  type VerifyOutcome,
} from "./index.js";

const userId = "user:tg:user:123" as UserIdentity["id"];
const otherUserId = "user:tg:user:999" as UserIdentity["id"];
const discharge = "discharge-token" as OpaqueToken;
const forbiddenGlaGrants = [
  "session-grant-sentinel",
  "operator-discharge-grant-sentinel",
  discharge,
];

/** A deterministic randomness seam so a test can predict the `state`/`nonce`/PKCE the adapter mints. */
function fixedRandomness(seq: { state: string; nonce: string }[]): OidcRandomness {
  let i = 0;
  return {
    pkce: async () => ({ verifier: `verifier-${i}`, challenge: `challenge-${i}` }),
    randomState: () => {
      const v = seq[Math.min(i, seq.length - 1)];
      return v?.state ?? `state-${i}`;
    },
    randomNonce: () => {
      const v = seq[Math.min(i, seq.length - 1)];
      const n = v?.nonce ?? `nonce-${i}`;
      i++; // advance after the nonce (state+nonce are read once per authorize, nonce last).
      return n;
    },
  };
}

/** Build a provider wired to a fake IdP, with injected stores + a captured outcome log. */
async function setup(over: Partial<AuthAuthentikOptions> = {}): Promise<{
  fake: FakeAuthentik;
  provider: AuthAuthentikProvider;
  subjects: InMemoryKv<BoundSubject>;
  attempts: InMemoryKv<PendingAttempt>;
  outcomes: VerifyOutcome[];
}> {
  const fake = await FakeAuthentik.create();
  const subjects = new InMemoryKv<BoundSubject>();
  const attempts = new InMemoryKv<PendingAttempt>();
  const outcomes: VerifyOutcome[] = [];
  const provider = new AuthAuthentikProvider({
    issuerUrl: fake.issuerUrl,
    clientId: fake.clientId,
    clientSecret: "super-secret",
    redirectUri: "https://gla.example/auth/callback",
    endpoints: fake.endpoints(),
    jwks: fake.jwks,
    fetch: fake.fetch,
    subjects,
    attempts,
    onVerifyOutcome: (o) => outcomes.push(o),
    ...over,
  });
  return { fake, provider, subjects, attempts, outcomes };
}

/** Read back the single pending attempt the adapter stored (there is one per authorize in these tests). */
function onlyAttempt(attempts: InMemoryKv<PendingAttempt>, state: string): PendingAttempt {
  const a = attempts.get(state);
  if (a === undefined) {
    throw new Error(`no attempt stored for state ${state}`);
  }
  return a;
}

function expectNoGlaGrant(value: string): void {
  for (const grant of forbiddenGlaGrants) {
    expect(value).not.toContain(String(grant));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AC#2 — challenge() builds the OIDC authorization request; verify happy path returns the fact.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#2 · challenge() builds an OIDC authorization request", () => {
  it("returns a {kind:redirect, authorizeUrl} carrying client_id/redirect_uri/scope/state/nonce/code_challenge(S256)", async () => {
    const { provider, subjects, attempts } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    // challenge requires a bound subject (precondition) — bind one first.
    subjects.set(userId, { sub: "sub-abc" });
    const challenge = (await provider.challenge(userId)) as RedirectChallenge;
    expect(challenge.kind).toBe("redirect");
    const url = new URL(challenge.authorizeUrl);
    const redirectUri = new URL(url.searchParams.get("redirect_uri") ?? "");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("gla-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://gla.example/auth/callback");
    expect(redirectUri.origin).toBe("https://gla.example");
    expect(redirectUri.pathname).toBe("/auth/callback");
    expect(redirectUri.search).toBe("");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("nonce")).toBe("no-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-0");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(challenge.authorizeUrl).not.toContain("grant=");
    expectNoGlaGrant(challenge.authorizeUrl);
    expectNoGlaGrant(url.searchParams.get("redirect_uri") ?? "");
    // The pending attempt is stored keyed by state, kind=authenticate, with the PKCE verifier.
    const attempt = onlyAttempt(attempts, "st-1");
    expect(attempt).toMatchObject({ userId, state: "st-1", nonce: "no-1", kind: "authenticate" });
    expect(attempt.codeVerifier).toBe("verifier-0");
  });

  it("challenge() THROWS for an un-enrolled user (no bound subject) — mirrors auth-webauthn's precondition", async () => {
    const { provider } = await setup();
    await expect(provider.challenge(userId)).rejects.toThrow(/un-enrolled|no bound/i);
  });

  it("uses real default PKCE/S256 when no randomness seam is injected (the code_challenge is a 43-char base64url SHA-256)", async () => {
    const { provider, subjects } = await setup();
    subjects.set(userId, { sub: "sub-abc" });
    const challenge = (await provider.challenge(userId)) as RedirectChallenge;
    const cc = new URL(challenge.authorizeUrl).searchParams.get("code_challenge") ?? "";
    // base64url(SHA-256) is 32 bytes → 43 chars, no padding.
    expect(cc).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("AC#2 · verifyAssertion happy path → {ok:true, authStrength} with the right strength", () => {
  it("passkey amr (swk) → ok:true, authStrength webauthn; fact shape is {ok, authStrength} (same kind as auth-webauthn)", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("code-xyz", { sub: "sub-abc", nonce: "no-1", amr: ["swk"] });
    const r = await provider.verifyAssertion(userId, { code: "code-xyz", state: "st-1" });
    expect(r).toEqual({
      ok: true,
      authStrength: "webauthn",
      assurance: {
        authStrength: "webauthn",
        level: "phishing-resistant",
        methodResolvable: true,
        providerEvidence: { amr: ["swk"] },
      },
    });
    // The token endpoint received the confidential-client auth + PKCE verifier + the auth-code grant.
    expect(fake.lastTokenRequest).toMatchObject({
      grantType: "authorization_code",
      code: "code-xyz",
      clientId: "gla-client",
      hasClientSecret: true,
      hasCodeVerifier: true,
      redirectUri: "https://gla.example/auth/callback",
    });
    expectNoGlaGrant(JSON.stringify(fake.lastTokenRequest));
  });

  it("password amr (pwd) → ok:true, authStrength password", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("code-pwd", { sub: "sub-abc", nonce: "no-1", amr: ["pwd"] });
    const r = await provider.verifyAssertion(userId, { code: "code-pwd", state: "st-1" });
    expect(r).toEqual({
      ok: true,
      authStrength: "password",
      assurance: {
        authStrength: "password",
        level: "password",
        methodResolvable: true,
        providerEvidence: { amr: ["pwd"] },
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3 — every rejection is a DISTINCT typed reason, each {ok:false, authStrength:none}, nothing bound.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#3 · every rejection yields a distinct typed reason + {ok:false, authStrength:none} + binds nothing", () => {
  /** Drive a challenge then a verify whose token is minted from `claims`/`code`, return the detailed outcome. */
  async function challengeThenVerify(
    claimsOrStage: (fake: FakeAuthentik, nonce: string) => Promise<{ code: string }>,
    opts: { bind?: string; over?: Partial<AuthAuthentikOptions> } = {},
  ): Promise<{
    outcome: VerifyOutcome;
    subjects: InMemoryKv<BoundSubject>;
    provider: AuthAuthentikProvider;
  }> {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
      ...opts.over,
    });
    subjects.set(userId, { sub: opts.bind ?? "sub-abc" });
    await provider.challenge(userId);
    const { code } = await claimsOrStage(fake, "no-1");
    const outcome = await provider.verifyAssertionDetailed(userId, { code, state: "st-1" });
    return { outcome, subjects, provider };
  }

  function expectFail(outcome: VerifyOutcome, reason: AuthFailReason): void {
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected failure");
    }
    expect(outcome.reason).toBe(reason);
  }

  it("bad signature → bad_signature", async () => {
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      const idToken = await fake.mintBadlySignedIdToken({ sub: "sub-abc", nonce });
      fake.stageToken("c", idToken);
      return { code: "c" };
    });
    expectFail(outcome, "bad_signature");
  });

  it("wrong issuer → wrong_issuer", async () => {
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      await fake.stageValidLogin("c", { sub: "sub-abc", nonce, iss: "https://evil.example/" });
      return { code: "c" };
    });
    expectFail(outcome, "wrong_issuer");
  });

  it("wrong audience → wrong_audience", async () => {
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      await fake.stageValidLogin("c", { sub: "sub-abc", nonce, aud: "some-other-client" });
      return { code: "c" };
    });
    expectFail(outcome, "wrong_audience");
  });

  it("expired (exp in the past) → expired", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      await fake.stageValidLogin("c", {
        sub: "sub-abc",
        nonce,
        iat: nowSec - 1000,
        exp: nowSec - 500,
      });
      return { code: "c" };
    });
    expectFail(outcome, "expired");
  });

  it("not-yet-valid (nbf in the future) → expired (skew tier)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      await fake.stageValidLogin("c", {
        sub: "sub-abc",
        nonce,
        iat: nowSec,
        nbf: nowSec + 5000,
        exp: nowSec + 9000,
      });
      return { code: "c" };
    });
    expectFail(outcome, "expired");
  });

  it("iat far in the future (beyond clock tolerance) → expired (skew tier)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { outcome } = await challengeThenVerify(async (fake, nonce) => {
      await fake.stageValidLogin("c", {
        sub: "sub-abc",
        nonce,
        iat: nowSec + 100000,
        exp: nowSec + 200000,
        nbf: nowSec, // valid nbf so jose passes, leaving OUR iat-skew check to reject.
      });
      return { code: "c" };
    });
    expectFail(outcome, "expired");
  });

  it("nonce mismatch → nonce_mismatch", async () => {
    const { outcome } = await challengeThenVerify(async (fake) => {
      // Mint with the WRONG nonce (not the attempt's "no-1").
      await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "WRONG-NONCE" });
      return { code: "c" };
    });
    expectFail(outcome, "nonce_mismatch");
  });

  it("missing nonce claim → nonce_mismatch (a token with no nonce cannot bind to the request)", async () => {
    const { outcome } = await challengeThenVerify(async (fake) => {
      await fake.stageValidLogin("c", { sub: "sub-abc" }); // no nonce minted
      return { code: "c" };
    });
    expectFail(outcome, "nonce_mismatch");
  });

  it("unknown state → state_unknown (no attempt was ever stored for it)", async () => {
    const { provider, subjects } = await setup();
    subjects.set(userId, { sub: "sub-abc" });
    const outcome = await provider.verifyAssertionDetailed(userId, {
      code: "c",
      state: "never-issued",
    });
    expectFail(outcome, "state_unknown");
    expect(outcome.ok).toBe(false);
  });

  it("replayed state → state_unknown on the SECOND use (one-time-consume on success)", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("code-1", { sub: "sub-abc", nonce: "no-1", amr: ["swk"] });
    // First use succeeds and consumes the attempt.
    const first = await provider.verifyAssertion(userId, { code: "code-1", state: "st-1" });
    expect(first.ok).toBe(true);
    // Replaying the same {code,state} now finds no attempt → state_unknown.
    const second = await provider.verifyAssertionDetailed(userId, {
      code: "code-1",
      state: "st-1",
    });
    expectFail(second, "state_unknown");
  });

  it("token-exchange HTTP failure → token_exchange_failed", async () => {
    const { outcome } = await challengeThenVerify(async (fake) => {
      fake.stageHttpError("c", 500);
      return { code: "c" };
    });
    expectFail(outcome, "token_exchange_failed");
  });

  it("2xx token response with no id_token → no_id_token", async () => {
    const { outcome } = await challengeThenVerify(async (fake) => {
      fake.stageNoIdToken("c");
      return { code: "c" };
    });
    expectFail(outcome, "no_id_token");
  });

  it("subject mismatch → subject_mismatch (a valid login for a DIFFERENT sub than the recipient's binding)", async () => {
    const { outcome, subjects } = await challengeThenVerify(
      async (fake, nonce) => {
        // A perfectly valid id_token — but for sub "intruder", not the recipient's bound "sub-abc".
        await fake.stageValidLogin("c", { sub: "intruder", nonce, amr: ["swk"] });
        return { code: "c" };
      },
      { bind: "sub-abc" },
    );
    expectFail(outcome, "subject_mismatch");
    // The binding is unchanged (still the original recipient's sub) and nothing new was bound.
    expect(subjects.get(userId)?.sub).toBe("sub-abc");
  });

  it("user mismatch → user_mismatch (a callback whose attempt was begun by a DIFFERENT recipient)", async () => {
    const { provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    subjects.set(otherUserId, { sub: "sub-other" });
    // userId begins the attempt (state st-1)…
    await provider.challenge(userId);
    // …but otherUserId presents the callback for st-1 → user_mismatch.
    const outcome = await provider.verifyAssertionDetailed(otherUserId, {
      code: "c",
      state: "st-1",
    });
    expectFail(outcome, "user_mismatch");
  });

  it("a non-{code,state} assertion → state_unknown (defensive parse)", async () => {
    const { provider, subjects } = await setup();
    subjects.set(userId, { sub: "sub-abc" });
    const outcome = await provider.verifyAssertionDetailed(userId, { garbage: true });
    expectFail(outcome, "state_unknown");
  });

  it("no rejection asserts identity/strength: every failure path returns authStrength none via the port method", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("c", { sub: "intruder", nonce: "no-1", amr: ["swk"] });
    const r = await provider.verifyAssertion(userId, { code: "c", state: "st-1" });
    expect(r).toEqual({ ok: false, authStrength: "none" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#4 — finishEnrollment binds the sub; later verify with that sub succeeds, stable; a different sub fails.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#4 · finishEnrollment binds the authentik subject; step-up then enforces it", () => {
  it("binds {sub} on a verified id_token and returns {credentialId: sub, authStrength}", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "en-1", nonce: "enon-1" }]),
    });
    await provider.beginEnrollment(userId, discharge);
    await fake.stageValidLogin("enroll-code", {
      sub: "sub-enrolled",
      nonce: "enon-1",
      amr: ["swk"],
    });
    const rec = await provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" });
    expect(rec).toEqual({
      credentialId: "sub-enrolled",
      authStrength: "webauthn",
      assurance: {
        authStrength: "webauthn",
        level: "phishing-resistant",
        methodResolvable: true,
        providerEvidence: { amr: ["swk"] },
      },
    });
    // The durable binding now exists (the delegated analogue of a stored credential).
    expect(subjects.get(userId)).toEqual({ sub: "sub-enrolled" });
    expect(provider.isEnrolled(userId)).toBe(true);
    expect(provider.getBoundSubject(userId)?.sub).toBe("sub-enrolled");
  });

  it("after enrollment, a later step-up for the SAME recipient with that sub SUCCEEDS, and the sub reproduces (stable)", async () => {
    const fake = await FakeAuthentik.create();
    const subjects = new InMemoryKv<BoundSubject>();
    const provider = new AuthAuthentikProvider({
      issuerUrl: fake.issuerUrl,
      clientId: fake.clientId,
      clientSecret: "s",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: fake.endpoints(),
      jwks: fake.jwks,
      fetch: fake.fetch,
      subjects,
      randomness: fixedRandomness([
        { state: "en-1", nonce: "enon-1" },
        { state: "au-1", nonce: "anon-1" },
      ]),
    });
    // Enroll → bind sub-stable.
    await provider.beginEnrollment(userId, discharge);
    await fake.stageValidLogin("enroll-code", { sub: "sub-stable", nonce: "enon-1", amr: ["pwd"] });
    await provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" });
    // Later step-up with the SAME sub succeeds.
    await provider.challenge(userId);
    await fake.stageValidLogin("auth-code", { sub: "sub-stable", nonce: "anon-1", amr: ["swk"] });
    const r = await provider.verifyAssertion(userId, { code: "auth-code", state: "au-1" });
    expect(r).toMatchObject({
      ok: true,
      authStrength: "webauthn",
      assurance: { level: "phishing-resistant", methodResolvable: true },
    });
    // The binding is the same stable sub throughout (doc §9 risk 3 — subject stability).
    expect(subjects.get(userId)?.sub).toBe("sub-stable");
  });

  it("after enrollment, a step-up presenting a DIFFERENT sub FAILS (subject_mismatch) — recipient-binding", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([
        { state: "en-1", nonce: "enon-1" },
        { state: "au-1", nonce: "anon-1" },
      ]),
    });
    await provider.beginEnrollment(userId, discharge);
    await fake.stageValidLogin("enroll-code", { sub: "sub-real", nonce: "enon-1", amr: ["swk"] });
    await provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" });
    await provider.challenge(userId);
    await fake.stageValidLogin("auth-code", {
      sub: "sub-DIFFERENT",
      nonce: "anon-1",
      amr: ["swk"],
    });
    const outcome = await provider.verifyAssertionDetailed(userId, {
      code: "auth-code",
      state: "au-1",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("subject_mismatch");
    }
    expect(subjects.get(userId)?.sub).toBe("sub-real");
  });
});

describe("AC#4 / atomicity · finishEnrollment is no-half-bound + one-time", () => {
  it("THROWS and binds NOTHING on a failed id_token (no half-bound) — mirrors auth-webauthn", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "en-1", nonce: "enon-1" }]),
    });
    await provider.beginEnrollment(userId, discharge);
    // Mint a token with the WRONG audience → validation fails → finishEnrollment must throw, bind nothing.
    await fake.stageValidLogin("enroll-code", {
      sub: "sub-x",
      nonce: "enon-1",
      aud: "wrong-aud",
    });
    await expect(
      provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" }),
    ).rejects.toThrow(/did not verify|wrong_audience/i);
    expect(provider.isEnrolled(userId)).toBe(false);
    expect(subjects.get(userId)).toBeUndefined();
  });

  it("THROWS on an unknown state (no pending enrollment attempt) and binds nothing", async () => {
    const { provider } = await setup();
    await expect(provider.finishEnrollment(userId, { code: "c", state: "never" })).rejects.toThrow(
      /did not verify|state_unknown/i,
    );
    expect(provider.isEnrolled(userId)).toBe(false);
  });

  it("an enrollment code cannot be replayed: the attempt is consumed on success (second finish → state_unknown throw)", async () => {
    const { fake, provider } = await setup({
      randomness: fixedRandomness([{ state: "en-1", nonce: "enon-1" }]),
    });
    await provider.beginEnrollment(userId, discharge);
    await fake.stageValidLogin("enroll-code", { sub: "sub-1", nonce: "enon-1", amr: ["swk"] });
    await provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" });
    await expect(
      provider.finishEnrollment(userId, { code: "enroll-code", state: "en-1" }),
    ).rejects.toThrow(/state_unknown|did not verify/i);
  });

  it("cross-kind defense: a register attempt cannot be consumed by verifyAssertion (wrong_attempt_kind)", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "en-1", nonce: "enon-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" }); // so challenge() precondition isn't the blocker
    // Begin a REGISTER attempt (state en-1)…
    await provider.beginEnrollment(userId, discharge);
    await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "enon-1", amr: ["swk"] });
    // …then try to use it at verifyAssertion (which expects an `authenticate` attempt).
    const outcome = await provider.verifyAssertionDetailed(userId, { code: "c", state: "en-1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("wrong_attempt_kind");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3/§3 — attempt TTL expiry (a stale callback is refused).
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 · a stale pending attempt past its TTL is refused (attempt_expired)", () => {
  it("verifyAssertion refuses an attempt older than attemptTtlMs", async () => {
    let clock = 1_000_000;
    const { fake, provider, subjects } = await setup({
      attemptTtlMs: 1000,
      now: () => clock,
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "no-1", amr: ["swk"] });
    // Advance the clock past the TTL.
    clock += 5000;
    const outcome = await provider.verifyAssertionDetailed(userId, { code: "c", state: "st-1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("attempt_expired");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC#3 · the diagnostic sink surfaces the typed reason (and the secret never appears).
// ─────────────────────────────────────────────────────────────────────────────

describe("AC#3 · onVerifyOutcome surfaces the discriminated outcome for observability", () => {
  it("emits a {ok:false, reason} on failure and {ok:true, authStrength, sub} on success", async () => {
    const { fake, provider, subjects, outcomes } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "no-1", amr: ["swk", "pwd"] });
    await provider.verifyAssertion(userId, { code: "c", state: "st-1" });
    expect(outcomes.at(-1)).toMatchObject({ ok: true, authStrength: "webauthn", sub: "sub-abc" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 (security review) — multi-audience id_token requires `azp === clientId` (OIDC Core §3.1.3.7).
// jose's `audience` option only checks MEMBERSHIP, so a token aud:["gla-client","attacker-client"] would
// otherwise pass for a co-listed client. The adapter requires `azp` to equal our client id when aud is a
// >1 array, else `azp_mismatch`. Single-audience tokens are unaffected (the guard never fires).
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 1 · multi-audience id_token requires a matching `azp` (else azp_mismatch)", () => {
  async function challengeThenVerifyAud(claims: {
    aud: string | string[];
    azp?: string;
  }): Promise<VerifyOutcome> {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("c", {
      sub: "sub-abc",
      nonce: "no-1",
      amr: ["swk"],
      aud: claims.aud,
      ...(claims.azp !== undefined ? { azp: claims.azp } : {}),
    });
    return provider.verifyAssertionDetailed(userId, { code: "c", state: "st-1" });
  }

  it("multi-aud with the WRONG azp → {ok:false, azp_mismatch}", async () => {
    const outcome = await challengeThenVerifyAud({
      aud: ["gla-client", "attacker-client"],
      azp: "attacker-client",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("azp_mismatch");
    }
  });

  it("multi-aud with ABSENT azp → {ok:false, azp_mismatch}", async () => {
    const outcome = await challengeThenVerifyAud({ aud: ["gla-client", "attacker-client"] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("azp_mismatch");
    }
  });

  it("multi-aud with the CORRECT azp (our client id) → ok:true (the token WAS issued for us)", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("c", {
      sub: "sub-abc",
      nonce: "no-1",
      amr: ["swk"],
      aud: ["gla-client", "other-client"],
      azp: "gla-client",
    });
    const r = await provider.verifyAssertion(userId, { code: "c", state: "st-1" });
    expect(r).toMatchObject({
      ok: true,
      authStrength: "webauthn",
      assurance: { level: "phishing-resistant", methodResolvable: true },
    });
  });

  it("SINGLE-audience token is unaffected by the azp guard (no azp present, still ok) — behaves as before", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    // aud is the single client id (the default) — the guard (aud-array length > 1) never fires.
    await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "no-1", amr: ["pwd"] });
    const r = await provider.verifyAssertion(userId, { code: "c", state: "st-1" });
    expect(r).toMatchObject({
      ok: true,
      authStrength: "password",
      assurance: { level: "password", methodResolvable: true },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 (security review) — one-time-use TOCTOU. The pending attempt is CLAIMED (read + deleted) atomically
// before the awaited token-exchange/JWKS round-trip, so two concurrent callbacks with the same {code,state}
// cannot BOTH succeed, and a failed exchange burns the state (no live attempt to retry/replay).
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 2 · the pending attempt is consumed atomically at claim time (TOCTOU-safe)", () => {
  it("two CONCURRENT verifyAssertion({code,state}) → exactly ONE ok, the other state_unknown", async () => {
    const fake = await FakeAuthentik.create();
    const subjects = new InMemoryKv<BoundSubject>();
    // Wrap the fake fetch with a small async delay so BOTH verify calls are in-flight at once (the real
    // TOCTOU window). With the delete-on-claim fix, the second call's synchronous get→delete already finds
    // nothing, so only one reaches the (delayed) network at all.
    const slowFetch: typeof fake.fetch = async (input, init) => {
      await new Promise((r) => setTimeout(r, 15));
      return fake.fetch(input, init);
    };
    const provider = new AuthAuthentikProvider({
      issuerUrl: fake.issuerUrl,
      clientId: fake.clientId,
      clientSecret: "s",
      redirectUri: "https://gla.example/auth/callback",
      endpoints: fake.endpoints(),
      jwks: fake.jwks,
      fetch: slowFetch,
      subjects,
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    await fake.stageValidLogin("code-1", { sub: "sub-abc", nonce: "no-1", amr: ["swk"] });

    const [a, b] = await Promise.all([
      provider.verifyAssertionDetailed(userId, { code: "code-1", state: "st-1" }),
      provider.verifyAssertionDetailed(userId, { code: "code-1", state: "st-1" }),
    ]);
    const okCount = [a, b].filter((o) => o.ok).length;
    expect(okCount).toBe(1); // exactly one succeeds — the other lost the claim race.
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.reason).toBe("state_unknown");
    }
  });

  it("a FAILED token exchange BURNS the state — a replay with the same {code,state} → state_unknown", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    // First attempt: the token endpoint fails → token_exchange_failed, and the state is consumed at claim time.
    fake.stageHttpError("c", 500);
    const first = await provider.verifyAssertionDetailed(userId, { code: "c", state: "st-1" });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.reason).toBe("token_exchange_failed");
    }
    // Now the attacker "fixes" the token endpoint and replays the SAME state — it must be gone (one-time).
    await fake.stageValidLogin("c", { sub: "sub-abc", nonce: "no-1", amr: ["swk"] });
    const replay = await provider.verifyAssertionDetailed(userId, { code: "c", state: "st-1" });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.reason).toBe("state_unknown");
    }
  });

  it("finishEnrollment's register attempt is ALSO burned on a failed exchange (one-time, no half-bound)", async () => {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "en-1", nonce: "enon-1" }]),
    });
    await provider.beginEnrollment(userId, discharge);
    fake.stageHttpError("c", 500);
    await expect(provider.finishEnrollment(userId, { code: "c", state: "en-1" })).rejects.toThrow(
      /token_exchange_failed|did not verify/i,
    );
    expect(subjects.get(userId)).toBeUndefined();
    // The state is burned: a follow-up finish with a now-valid token still fails (state consumed).
    await fake.stageValidLogin("c", { sub: "sub-x", nonce: "enon-1", amr: ["swk"] });
    await expect(provider.finishEnrollment(userId, { code: "c", state: "en-1" })).rejects.toThrow(
      /state_unknown|did not verify/i,
    );
    expect(subjects.get(userId)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 (security review) — the signing algorithm is pinned to an asymmetric allow-list (ES256/RS256), and
// an unsupported/disallowed algorithm is classified as `bad_signature` (not a generic invalid_token).
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 3 · alg:none / HMAC-with-pubkey are refused as bad_signature", () => {
  /** Mint an id_token via `mint(fake)`, wire it through the SAME fake, and return the verify outcome. */
  async function challengeThenVerifyMinted(
    mint: (fake: FakeAuthentik) => Promise<string>,
  ): Promise<VerifyOutcome> {
    const { fake, provider, subjects } = await setup({
      randomness: fixedRandomness([{ state: "st-1", nonce: "no-1" }]),
    });
    subjects.set(userId, { sub: "sub-abc" });
    await provider.challenge(userId);
    fake.stageToken("c", await mint(fake));
    return provider.verifyAssertionDetailed(userId, { code: "c", state: "st-1" });
  }

  it("an alg:none (unsecured) id_token → bad_signature (the pinned allow-list refuses `none`)", async () => {
    const outcome = await challengeThenVerifyMinted((fake) =>
      fake.mintNoneAlgIdToken({ sub: "sub-abc", nonce: "no-1" }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("bad_signature");
    }
  });

  it("an HMAC (HS256) id_token signed with a symmetric key → bad_signature (alg-confusion refused)", async () => {
    const outcome = await challengeThenVerifyMinted((fake) =>
      fake.mintHmacIdToken({ sub: "sub-abc", nonce: "no-1" }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("bad_signature");
    }
  });
});
