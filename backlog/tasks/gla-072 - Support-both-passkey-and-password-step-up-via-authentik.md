---
id: GLA-072
title: Support both passkey and password step-up via authentik
status: To Do
assignee: []
created_date: '2026-06-03 15:41'
updated_date: '2026-06-03 17:22'
labels:
  - authentik
  - impl
dependencies:
  - GLA-068
  - GLA-071
priority: medium
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: delivers the dual-method capability — the whole point of the delegated provider — so a recipient can authenticate with a passkey or, lacking one, a password, and the gateway gates by required strength. Builds the step designed in its plan. Depends on the adapter and the flow plan. Out of scope: the installer standup (GLA-074).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A recipient completes a step-up with a passkey, and the result carries the strongest auth-strength.
- [ ] #2 A recipient with no passkey completes a step-up with a password, and the result carries the password-level auth-strength.
- [ ] #3 A step that requires the stronger method admits the passkey result and rejects the password-only result.
- [ ] #4 A wrong password or otherwise failed assertion is refused with a typed reason and admits no one.
- [ ] #5 Which method a recipient used is reported as part of the auth fact, so an enforcement point can branch on it.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CARRIED FROM GLA-070 review: the gateway's /enroll/verify SUCCESS-RESPONSE body hardcodes auth_strength:"webauthn" (packages/gateway/src/index.ts ~line 592). The RECORDED enrollment fact is correct (from finishEnrollment); only the HTTP response string is wrong — under authentik a password-grade enroll would still report "webauthn" in that body. Harmless until 072 drives /enroll/verify over the browser callback. When 072 touches this, fix it PROVIDER-AGNOSTICALLY (echo the recorded/returned strength, do NOT special-case OIDC in the gateway — the gateway is fixed core). Same for the step-up response if it hardcodes a strength.
<!-- SECTION:NOTES:END -->
