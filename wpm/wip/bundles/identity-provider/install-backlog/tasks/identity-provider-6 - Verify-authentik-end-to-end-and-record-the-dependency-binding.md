---
id: IDENTITY-PROVIDER-6
title: Verify authentik end to end and record the dependency binding
status: To Do
assignee: []
created_date: '2026-06-08 15:45'
labels:
  - 'kind:state'
  - 'step:verify-authentik'
milestone: 0.1.0
dependencies:
  - IDENTITY-PROVIDER-5
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
VERIFY step (kind:state) for the authentik branch, gated on the GLA_AUTH_PROVIDER=authentik selection (no-op for the in-tree default — the verify-rp task covers that path). Prove the provider works end to end against the running instance, not merely that it was configured, then record the dependency-binding receipt the setup task's outcomes are gated on. Probe the live provider: its OIDC discovery document answers and the advertised token and JWKS endpoints answer with keys; an authorization request carrying GLA's client id and configured redirect URI is accepted (the client and redirect URI are recognized) rather than rejected as an unknown client or bad redirect; a passkey login and a password login each complete and yield an id_token whose authentication-method claim maps, respectively, to the stronger and the weaker strength — proving the flow offers both methods AND that they are distinguishable; enrolling then re-authenticating the same recipient yields the same subject (the subject is immutable). Confirm the connection GLA holds is reachable from where GLA runs and that GLA's own dependency probe reads the recorded binding and reports the identity-provider dependency as available, closing the loop that the runtime adapter can reach what was stood up. Record the dependency binding — the dependency name, the ownership mode, the connection (issuer, client id, redirect URI) with the client secret held only as a secret reference, whether it was installed or adopted, the inverse op for an installed stack, and the latest probe result — and re-read and confirm the setup receipt entries. On failure return to setup. The end-to-end passkey-and-password proof and the immutable-subject proof require a real running authentik; where one is not available to probe (for example a constrained build or pre-deploy environment), this is recorded as deferred to the real deployment, while the deterministic strength-mapping behavior the proof relies on is already covered by the runtime adapter's own tests against an in-process OIDC double. Rehearsal evidence (already PROVEN against a real authentik 2025.10.4, the Redis-free path — postgres + server + worker only): the stack stood up from this bundle's compose template; OIDC discovery, the JWKS (RS256 keys), and the token endpoint all answered; an authorization request for GLA's client and redirect URI was accepted; the subject mode was hashed_user_id (an immutable sub, the same sub reproduced across logins); after applying this bundle's amr scope mapping a REAL password login through authentik's hosted flow yielded an id_token carrying amr ["pwd"] (with acr goauthentik.io/providers/oauth2/default and gla_auth_method "password"), and GLA's real adapter resolved verifyAssertion to {ok:true, authStrength:"password"} with methodResolvable true; the subject-mismatch negative (a valid id_token for a different sub) was refused. The one part still genuinely deploy-only is the real passkey -> webauthn round-trip (registering a real passkey at authentik and driving it through the browser is authentik flow-config exercised at the deployment); the amr mechanism it relies on (passkey -> amr ["swk"] -> webauthn) is the same proven expression, so this remains the honest deferral.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the provider answers: its OIDC discovery document responds successfully with a valid configuration, and the token and JWKS endpoints it advertises answer (the JWKS returns signing keys)
- [ ] #2 the relying-party application is recognized: an authorization request carrying GLA's client id and configured redirect URI is accepted rather than refused as an unknown client or an unregistered redirect URI
- [ ] #3 both methods work and are distinguishable end to end: a passkey login yields an id_token whose authentication-method claim maps to the stronger strength, and a password login yields one that maps to the weaker strength
- [ ] #4 the subject is stable: enrolling and then re-authenticating the same recipient yields the same subject value, demonstrating it is immutable across logins
- [ ] #5 GLA's own dependency probe reads the recorded binding and reports the identity-provider dependency as available from where GLA runs, confirming the runtime can actually reach the provider, and a provider that does not answer surfaces as unavailable rather than a silent pass
- [ ] #6 a verifiable receipt of the binding is recorded — the dependency name, ownership mode, connection (issuer, client id, redirect URI), installed-versus-adopted, and the inverse op for an installed stack — with the client secret present only as a secret reference and never as a literal in the receipt
- [ ] #7 the receipt is idempotent on re-run: re-running converges to the same recorded binding and provider state without creating a duplicate provider or application, and re-reading the setup receipt entries confirms them present and accurate
- [ ] #8 where no real authentik is available to probe, the end-to-end method-distinguishing proof and the immutable-subject proof are recorded as deferred to the real deployment rather than falsely marked satisfied, so an unverified install is never recorded as verified
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Effect verified against the task acceptance criteria (verify before record)
- [ ] #2 Files placed or modified are recorded via --ref and their checksum journaled in the notes
- [ ] #3 Ownership recorded in the notes: installed by us vs adopted from the user's machine
- [ ] #4 Inverse op recorded in the notes: the uninstall step plus the condition under which it runs
- [ ] #5 Decisions and their rationale recorded (notes, or --final for a pinned decision)
- [ ] #6 Non-file effects recorded in the notes: services started, registrations made, artifacts built
<!-- DOD:END -->
