# GLA — Slice 6: the second handoff + the "without rebuilding" deltas (scenario-01 Phases 9–14)

> **Status:** Slice design + build note. **Satisfies the PLAN tasks** GLA-026, GLA-028, GLA-030, GLA-036, GLA-046,
> GLA-048, **GLA-050**, GLA-052, GLA-054, GLA-056, GLA-058, GLA-060, GLA-062, **and frames the IMPL tasks** GLA-027,
> GLA-029, GLA-031, GLA-037, GLA-047, GLA-049, **GLA-051**, GLA-053, GLA-055, GLA-057, GLA-059, GLA-061, GLA-063.
>
> **Scope:** the SECOND handoff and the "X without rebuilding" deltas. Most of these tasks assert the EXISTING
> capsule / session / handoff / connector / completion machinery (Slices 1–5) handles the second pass with **no new
> mechanism** — the agent drives via its connector again, re-opens a window onto the SAME capsule, the human enters a
> code agent-blind, the second completion fires on `/dashboard`, the window closes, the agent configures the account
> and the session stays active. This slice **verifies each delta with a test (no rebuild)** and, where the existing
> code genuinely did not yet cover it, **adds the minimal mechanism**. **The one genuinely new mechanism is
> auth-reuse on re-open (GLA-050/051):** on a second window for the same recipient, a still-valid prior step-up is
> reused (no re-prompt). Two narrow seam-level fixes were also needed for the second pass to work end-to-end (the
> handoff-grant **class** and the url-watcher **intermediate edge-trigger**); both are recorded below.
>
> This conforms to the committed spec; cross-references (`see docs/<x>`) are the source of truth and are not
> restated. Where this names a concrete package it concretizes a `baseline.md §1` layout slot, never overriding a
> goal, vocabulary, or invariant.
>
> **Reads against:** `scenario-01-unified.html` Phases 9/11/12/13/14; `docs/05-cli-and-entities.md` §6 (the H2 calls);
> `components/{identity-and-auth,access-gateway,session-service,capsule}.md`; `slice-4b-handoff.md` (the open-window
> saga + verify-at-edge + step-up + WS proxy) and `slice-5-completion.md` (completion → close + agent-blind).

## Rule-3 note

`bmad-dev-story` (and `bmad-quick-dev`) **were loaded** (the skills activate) but cannot run unattended for these
tasks — the same blocker recorded for Slices 4b/5. `bmad-dev-story` Step 1 (`tag="sprint-status"`) reads
`{implementation_artifacts}/sprint-status.yaml` to find the next ready story and open a context-filled per-story spec
file; in this repo `_bmad-output/implementation-artifacts/` is **empty** (no `sprint-status.yaml`, no per-story
`*-*-*.md`) — work is tracked in Backlog.md, not BMAD per-story files — so the workflow hits its interactive
`<ask>Choose option [1]/[2]/[3]/[4]</ask>` HALT (verified: it lists "No ready-for-dev stories found" and asks for a
choice/path). Per `AGENTS.md` Rule-3's explicit allowance, that path was stopped, the blocker named, and this slice
was implemented **directly from the committed design set** as the stated fallback. The BMAD skills actually run per
task are recorded in each task's `--notes`.

---

## §the core insight — "without rebuilding" = verify the existing seam, add a mechanism only where it is genuinely absent

Scenario-01 deliberately reuses one capsule, one session, and one connector across BOTH handoffs (`session-service.md`
Decisions: "Multiple human pauses are re-opened windows, not extra sessions"). So the second pass is, by design, the
SAME machinery exercised a second time. The job is to **prove** each delta works as-is, and to add the **minimal**
mechanism only where the first end-to-end exercise of the second pass reveals a real gap. The headline evidence is a
**single REAL two-handoff E2E** (`packages/app/src/two-handoff-e2e.test.ts`, real Chromium + a stub
`/register→/verify→/dashboard` site) that runs window 1 (submitted) AND window 2 (verified, auth reused) end-to-end —
it is the proving test for most deltas below.

---

## §auth-reuse on re-open — the one genuinely new mechanism (GLA-050/051)

**The delta.** `scenario-01-unified.html` Phase 12: "verify grant-2, macaroon + revocation, **auth still valid, no
re-prompt**." `identity-and-auth.md`: Phase 12 — "asked whether the recipient's auth is still valid; if so, no
re-prompt, else re-auth." Slice 4b's step-up (`slice-4b-handoff.md §verify`) authorizes **a specific grant** after a
successful WebAuthn ceremony (the gateway adds the grant id to its `authorizedGrants` set; the WS upgrade requires it).
On a SECOND window a NEW grant-2 is minted; its id is not in `authorizedGrants`, so without a new mechanism the
recipient would be re-prompted for WebAuthn. The existing seam does **not** cover reuse — so this is the one place a
mechanism is genuinely added.

**The contract (recipient-auth validity).** On a successful step-up the Access Gateway records a short-lived
**recipient-level auth validity** — `{recipient, auth_strength, expiresAt}` — keyed by the recipient **read from the
SIGNED grant** (never client-supplied), TTL-bounded by `authReuseTtlMs` (default ≈15 min, the handoff-window TTL; `0`
disables reuse). On a later window:

- **Reuse (no re-prompt).** If the bound recipient has an **unexpired** validity whose auth assurance satisfies the
  selected deployment policy, the gateway authorizes THIS window's grant **without** a fresh ceremony and serves a
  *reused-auth* page that opens the noVNC stream directly. The WS upgrade also reuses (a client that goes straight to
  the upgrade is authorized by the same recipient-validity check).
- **Re-prompt (Phase 6 behaviour).** An **expired** validity (pruned on read) or an **absent** one (a different
  recipient never authenticated) falls through to the full step-up page — exactly Slice 4b.

**The three load-bearing properties (each has a test).**

1. **Recipient-specific.** Keyed by the recipient caveat of the *signature-authenticated* grant. A grant bound to a
   DIFFERENT recipient has no validity → re-prompts (a recipient's reuse never leaks to another).
2. **TTL-bounded.** A validity past its `expiresAt` is pruned and treated as absent → re-prompts. `authReuseTtlMs: 0`
   disables reuse entirely (always re-prompt).
3. **Not bypassable — the grant is STILL verified every request.** Reuse only skips the *interactive WebAuthn
   ceremony*; it never skips the cryptographic grant verify (signature, recipient caveat, TTL, scope, revocation). A
   forged/invalid grant for an already-authenticated recipient is refused at the edge **before** the reuse check (the
   reuse is gated on a grant that already verified AND whose signed recipient is the one with a valid auth).

**Where it lives.** Cleanly behind the existing auth seam, in `packages/gateway` (the enforcement point that already
owns the per-grant step-up state). A new `recipientAuth: Map<recipient, {authStrength, expiresAt}>` + the
`authReuseTtlMs` option; `recordRecipientAuth` on a successful step-up; `recipientAuthValid` consulted by the handoff
page GET and the WS upgrade. `@gla/identity` is unchanged — the validity is an **edge** fact (the gateway is where
"is this recipient still authenticated for this surface" is decided); identity still owns the credential + reports
`auth_strength` facts. The composition root threads `authReuseTtlMs` through `createProvisioningBridge`'s handoff
options.

---

## §the two narrow seam fixes the second pass required (recorded honestly)

The first end-to-end exercise of the second pass (the real two-handoff E2E) surfaced two latent gaps that had **no
test coverage** before because no earlier slice drove the task-attenuated handoff grant through the gateway, nor
re-opened a window while the capsule still showed the intermediate URL. Both are minimal, scenario-faithful fixes.

### 1. The handoff grant must be `session`-class even when it descends from the task cap (capability + kernel)

`access-gateway.md` invariant: the edge verifies the grant by recipient + scope + **class=`session`**. The handoff
grant is **attenuated from the task cap** for the revoke-the-parent cascade (`capability-service.md`). But macaroon
attenuation **inherits the parent's class**, so the attenuated grant was `task`/`agent-authority`-class — and the edge
refused it (`auth.insufficient`) on the *first* window of any **real** (task-rooted) session. No existing test caught
this: the one parent-attenuated verify test only passed because the parent was revoked first (so verify short-circuited
on `auth.revoked` *before* the class check). **Fix:** the kernel `attenuate` gains an optional `childClass` that
RE-CLASSES the child to a narrower class while preserving the full ancestor lineage (the cascade) and the
reject-or-narrow widening guard; `mintSessionGrant` passes `"session"`. The class is folded into the signed tag
(tamper-evident). This is a minimal, sound concretization — re-classing only changes the label; caveats still only
narrow and revoking ANY ancestor still cascades (tests added in `capability-lineage.test.ts` +
`session-grant.test.ts`).

### 2. The url-watcher intermediate must be EDGE-triggered so the second window does not re-complete on the stale URL (detector-url)

scenario-01 closes window 1 on the `/verify` **intermediate** (status `submitted`) and window 2 on the `/dashboard`
**complete** (status `verified`). When window 2 RE-OPENS, the capsule still shows `/verify` (window 1's terminal page,
which the agent also inspects in Phase 9). The url-watcher's intermediate match was **level-triggered** (it fired
whenever the page matched), so window 2's fresh watch instantly re-fired the `/verify` intermediate and closed window 2
prematurely with `submitted` instead of waiting for `/dashboard`. **Fix:** the intermediate is now **edge-triggered** —
it fires only on a TRANSITION *into* it (the previous poll did not match, this one does); the first observed URL is the
BASELINE (suppressed). The `complete_on` stays level-triggered (the terminal navigation fires regardless of where it
started). Window 1 (transitions `/register`→`/verify`) still fires the intermediate; window 2 (opens already at
`/verify`, baseline-suppressed) only completes on `/dashboard` (tests added in `detector-url.test.ts`).

---

## §the delta-by-delta map (what was verified-as-is vs. what needed code)

Every PLAN/IMPL pair below is checked against the existing seam. "Verified-as-is" = the existing Slice 1–5 mechanism
covers it, proven by a test (no rebuild). "Code added" = the minimal mechanism named above.

| Delta (PLAN / IMPL) | Existing seam | Verdict | Proving test |
|---|---|---|---|
| **Drive via connector** (GLA-026/027) | Slice 3 CDP brokered connector; the Bridge surfaces it as data, work stays on the connector (`docs/05 §2`) | verified-as-is | two-handoff E2E (agent drives `/register`); `connector-cdp` tests |
| **Drive to a 2nd page** (GLA-028/029) | same connector, no rebuild | verified-as-is | two-handoff E2E (agent reads `/verify`, configures `/dashboard`) |
| **Resume driving on an active session** (GLA-030/031) | Slice 5 connector resume on window close; `session connector` re-emit | verified-as-is | two-handoff E2E (re-attach after window 1 + after window 2); `completion-e2e` |
| **Return auth result to the gateway** (GLA-036/037) | Slice 4b: identity reports `{ok, auth_strength}` FACTS → the gateway gates the entrypoint; a failure is a structured refusal | verified-as-is | `handoff.test.ts` step-up verify decision; two-handoff E2E (verified→proxy) |
| **Inspect after window 1** (GLA-046/047) | Slice 5 close returns session to `active`, capsule lives; connector resumes | verified-as-is | two-handoff E2E Phase 9 (agent re-reads `/verify`) |
| **Re-open onto the SAME capsule** (GLA-048/049) | `openHandoff` re-opens `active → opened` on the same runtime, no re-spawn (`session-service.md`) | verified-as-is | two-handoff E2E (same capsule id across both windows) |
| **Auth reused on re-open** (GLA-050/051) | — none — | **code added** (gateway recipient-auth validity) | `handoff.test.ts` auth-reuse block; two-handoff E2E (step-up NOT invoked the 2nd time) |
| **Reach on the reused-auth window** (GLA-052/053) | Slice 4b WS proxy, now authorized by reuse | verified-as-is (rides the reuse mechanism) | two-handoff E2E (reused-auth WS proxied); `handoff.test.ts` |
| **Enter code agent-blind** (GLA-054/055) | Slice 5 S-2 connector severance during a window | verified-as-is | two-handoff E2E (code reaches the site, leaks nowhere) |
| **Second completion** (GLA-056/057) | Slice 5 url-watcher + Completion service | **fix added** (intermediate edge-trigger, §above) so the 2nd completion fires on `/dashboard` | two-handoff E2E (verified); `detector-url.test.ts` edge-trigger |
| **Close the second window** (GLA-058/059) | Slice 5 close path (unmount, revoke, force-close, back to `active`) | verified-as-is | two-handoff E2E (session active + capsule live after the 2nd close) |
| **Configure the account** (GLA-060/061) | Slice 3 connector drive on the live capsule | verified-as-is | two-handoff E2E Phase 14 (agent configures `/dashboard`) |
| **Resume after configuration** (GLA-062/063) | session stays `active`, capsule keeps running | verified-as-is | two-handoff E2E (session active through configuration) |

> Honest summary: **one genuinely new mechanism** (auth-reuse, GLA-050/051) and **two narrow seam fixes** the second
> pass needed (the grant class; the intermediate edge-trigger). Everything else was **verified-as-is** with a test —
> the existing capsule/session/handoff/connector/completion machinery handled the second pass with no rebuild.

---

## §what remains (not this slice)

- **Slice 7 — teardown (GLA-064/065, Phase 15):** `gla task complete` tears down the capsule, revokes the grant +
  connector + task capabilities, wipes the temp profile.
- **Slice 8 — the cold E2E + packaging (GLA-066 + wpm bundles GLA-007..011 + deploy):** the whole scenario-01 run
  cold the way CI does, the wpm installer packages, and the hermes-1 deploy.
