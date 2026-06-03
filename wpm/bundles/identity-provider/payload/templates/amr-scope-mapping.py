# GLA — authentik OAuth2 SCOPE-MAPPING expression that injects `amr` into the id_token (identity-provider · GLA-074).
#
# WHY THIS IS REQUIRED (the load-bearing dual-method outcome, authentik-service-standup.md §3.2 / §8.2):
# authentik 2025.10 emits `amr: []` (EMPTY) by default and only a generic `acr` — it does NOT distinguish a
# passkey login from a password login out of the box. GLA reads `amr`/`acr` to derive AuthStrength; with no
# distinguishing claim it correctly FLOORS to `password` and NEVER up-maps (safe), but the dual-method *strength*
# claim (passkey -> `webauthn`) then cannot be realized. This expression makes the flow emit a DISTINGUISHING
# `amr`, which is exactly what install-backlog task identity-provider-5 AC#3 / -6 AC#3 require.
#
# PROVEN — this is the EXACT expression verified live against real authentik 2025.10.4 (the GLA-074 rehearsal),
# attached to GLA's OAuth2 provider's property mappings. A real password login through authentik's hosted flow
# yielded an id_token with `amr:["pwd"]` (and `acr: "goauthentik.io/providers/oauth2/default"`,
# `gla_auth_method:"password"`), and GLA's adapter resolved `verifyAssertion` -> `{ok:true,
# authStrength:"password", methodResolvable:true}`. The passkey arm emits `amr:["swk"] -> webauthn` by the same
# expression.
#
# THE MECHANISM (important — the naive approach does NOT work). authentik 2025.10 does NOT expose the login
# method on `request.context['auth_method']` in a scope-mapping expression (that is empty — which is *why* the
# default `amr` is `[]`). The reliable, proven source is the user's **most recent LOGIN Event**: authentik
# records the authentication method in the LOGIN event's `context['auth_method']`. The expression below reads it
# from `authentik.events.models.Event` (filtered to the current user's latest LOGIN), which is what produced the
# real `amr:["pwd"]` above.
#
# HOW TO APPLY (authentik API / admin UI), as a PROVIDER scope mapping:
#   - create a "Scope Mapping" (PropertyMapping, provider/scope) named e.g. "gla-amr-claim",
#   - scope_name: "openid"  (rides with the always-requested openid scope — no extra scope to request),
#   - expression: the body below,
#   - then ATTACH it to GLA's OAuth2 provider's `property_mappings` (alongside the standard openid/profile scopes).
#   API shape (an admin API token is needed — see the bootstrap seam in authentik-compose.yml.tmpl):
#     POST /api/v3/propertymappings/provider/scope/   { name, scope_name: "openid", expression }
#     PATCH the provider's property_mappings to include the returned pk.
#
# ADAPTER ALIGNMENT (no adapter change needed): GLA's default amr map
# (adapters/auth-authentik/src/strength.ts DEFAULT_METHOD_MAPS) maps {hwk,swk,webauthn,fido} -> "webauthn" and
# {pwd} -> "password" — which is EXACTLY what this expression emits, so `GLA_AUTHENTIK_AMR_MAP` needs no override
# for this recipe. If a deployment's flow records a different method label, tune the branches below (and/or
# `GLA_AUTHENTIK_AMR_MAP`) to the actual label — but it MUST emit something separating the two tiers.
#
# DEGRADATION (honest): if this mapping is NOT applied (or cannot read the method), `amr` stays empty and GLA
# floors every login to `password` — the integration runs as PASSWORD-ONLY (never up-maps a passkey to webauthn),
# and the operator must be warned. The verify task confirms the EMITTED amr against the running instance.
#
# ── The expression body (everything below this line) — paste as the scope mapping's Expression ──────────────
# Derive amr from the user's most recent login Event (authentik records auth_method there).
amr = []
method = None
try:
    from authentik.events.models import Event, EventAction
    ev = Event.objects.filter(action=EventAction.LOGIN, user__pk=request.user.pk).order_by("-created").first() if request and request.user else None
    if ev and ev.context:
        method = ev.context.get("auth_method")
except Exception as exc:
    method = None
m = (method or "").lower()
if "webauthn" in m or "fido" in m or "passkey" in m or "authenticator" in m:
    amr = ["swk"]
elif "password" in m:
    amr = ["pwd"]
elif m:
    amr = [m]
return {"amr": amr, "gla_auth_method": method}
