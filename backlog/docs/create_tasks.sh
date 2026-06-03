#!/usr/bin/env bash
set -euo pipefail
cd /home/claude/gla-project
declare -A ID
mk(){ local key="$1"; shift; local out id
  out="$(backlog task create "$@" --no-dod-defaults --plain 2>&1)" || { echo "ERR create $key"; echo "$out"; exit 1; }
  id="$(printf '%s' "$out" | grep -oiE 'gla-[0-9]+' | head -1 | tr 'A-Z' 'a-z')"
  [ -n "$id" ] || { echo "NO ID for $key"; echo "$out"; exit 1; }
  ID[$key]="$id"; printf '  %-18s %s\n' "$key" "$id"
}

echo "== FOUNDATION =="
mk F1 "Plan the GLA system-architecture baseline" -l foundation,plan --priority high --doc docs/01-architecture-overview.md \
 -d "Why: every later task builds on one architectural shape; this fixes that shape and the invariants the whole MVP must preserve. Produces design artifacts, not code. Use the architect skills and research current real-world precedents (admission control, capability systems, spawner models) on the internet before fixing decisions. Out of scope: per-module design and any implementation." \
 --ac "The macro decomposition is specified as a modular monolith with a narrow stable core (task, session, capability, route, completion, audit) and replaceable adapters around it, with the module list and boundaries named." \
 --ac "The cognition-versus-enforcement split is specified as an invariant: what the agent decides versus what code enforces, with the agent untrusted at every enforcement seam." \
 --ac "The two-actor capsule shape is specified: the agent enters unprivileged via the Agent Bridge, the human via the Access Gateway as the sole public entry, both meeting at one capsule." \
 --ac "Capability is specified as the single authorization primitive, with recipient-bound grants and agent-blind secrets named as system-wide invariants." \
 --ac "The deployment-profile model is specified, naming which enforcement seams are load-bearing in the local single-operator reference and which are deferred." \
 --ac "The horizontal-extension principle is specified: a new dependency or provider is added by registering against an existing seam, changing no core code." \
 --ac "A build-order plan exists that sequences the foundation, dependency, and per-step work into a valid order." \
 --ac "The operating experience is designed at a high level: the agent's command ergonomics and the operator's setup path, not only the internal mechanism."

mk F3 "Plan the shared kernel and cross-module contracts" -l foundation,plan --priority high --doc docs/04-capsule-assembly.md --doc docs/components/capability-service.md \
 -d "Why: the core vocabulary and seams are shared by every module; designing them once prevents drift. Produces the contract specification (entities, ports, schemas, taxonomies), not code. Use the architect skills and research contract precedents (Terraform provider schema, K8s admission shapes, macaroon caveats) on the internet. Depends on the architecture baseline. Out of scope: implementing the kernel; per-step behaviour." \
 --dep "${ID[F1]}" \
 --ac "The core entities are specified with fields and lifecycles: task, session, capability, route, completion, audit event." \
 --ac "The capability primitive is specified as a contract: its caveat classes (including operator-discharge and recipient-binding), attenuation, and stateless edge-verifiability, independent of any signing mechanism." \
 --ac "The AssemblySpec is specified as a versioned, schema-validated contract (apiVersion, kind, metadata, spec) including the mounts shape, sufficient for offline validation." \
 --ac "The typed config-schema vocabulary providers use to declare parameters is specified (types, required/optional, defaults, enum, min/max/pattern, conflicts/requires, sensitive)." \
 --ac "The stable error and exit-code taxonomy is specified as a contract other programs branch on, including the mount error namespace and its exit-code mapping." \
 --ac "Each module's port (the seam the core depends on) is specified by its method shape and guarantees, with no concrete adapter named." \
 --ac "The recipient-identity and enrollment model is specified as part of the identity contract, so a recipient can be established before any handoff verifies them." \
 --ac "An implementation plan for the kernel build task exists, ordered so contracts can be built before any module that depends on them." \
 --ac "Every external dependency the kernel itself needs is identified and classified traditional-code versus not; any non-traditional one has a wpm-installer-package task in this backlog."

mk F2 "Scaffold the modular-monolith skeleton and quality gate" -l foundation,impl --priority high --doc docs/01-architecture-overview.md --doc docs/05-cli-and-entities.md \
 -d "Why: the rest of the backlog needs a repository with enforced module boundaries and a runnable CLI entrypoint. Builds the empty skeleton and the quality gate the Definition of Done relies on. Depends on the architecture baseline. Out of scope: any module behaviour; the kernel contracts." \
 --dep "${ID[F1]}" \
 --ac "The repository builds and typechecks from a clean checkout." \
 --ac "The module boundaries from the architecture baseline exist as separate units, and a check fails the build if a core module imports a concrete adapter." \
 --ac "A single CLI binary named gla is present and runs, returning the documented exit codes (0 success, 2 usage) for trivial invocations." \
 --ac "The gla binary emits JSON to stdout by default and human-readable text only when stdout is a TTY." \
 --ac "Lint, typecheck, and test all run through one documented entrypoint." \
 --ac "A deliberately failing example in any quality gate is observable as a non-zero result, so the gate cannot be silently bypassed."

mk F4 "Implement the shared kernel and contracts" -l foundation,impl --priority high --doc docs/04-capsule-assembly.md --doc docs/components/capability-service.md --doc docs/components/task-service.md \
 -d "Why: every module depends on the core entities, the capability primitive, the assembly contract, and the error taxonomy. Builds them as in-tree code behind the designed ports. Depends on the contracts plan and the scaffold. Out of scope: module-specific behaviour and any provider." \
 --dep "${ID[F3]},${ID[F2]}" \
 --ac "The core entities exist with their specified fields and state transitions, and an invalid transition surfaces a typed, machine-distinguishable error." \
 --ac "A capability can be minted, attenuated, and verified, and verification succeeds or fails purely from the capability and request without a central lookup." \
 --ac "A recipient-bound capability verifies only for its bound recipient and fails closed for any other." \
 --ac "An AssemblySpec is validated offline against its schema: a well-formed spec passes, and each distinct defect is reported with its location in a single pass." \
 --ac "A provider config-schema rejects a value that violates a declared constraint, naming the offending field, before anything runs." \
 --ac "Every taxonomy error carries a stable code mapping to the documented exit code, so callers branch without parsing prose." \
 --ac "The kernel has no dependency on any concrete adapter or external service."

mk F5 "Plan the dependency and ownership strategy" -l foundation,dependency,plan --priority high --doc docs/02-provider-and-extension-model.md \
 -d "Why: the slice needs external pieces, and each must be classified before it is built; this does that research once and is the basis for the dependency tasks. Produces a classification artifact, not code. Use the architect skills and research current real-world options (policy engines, browser runtimes, view stacks, container runtimes, edge proxies, WebAuthn providers) on the internet. The capsule is assembled from separate local components, not one image. Out of scope: integrating or installing anything." \
 --dep "${ID[F1]}" \
 --ac "Every external dependency the scenario-01 slice needs is enumerated, including the capsule's separate layers: browser plus automation, the human-view stack, and the control protocol." \
 --ac "Each dependency is classified by the ownership rule (long-lived in-tree code, versus something touching the operator host or wiring the operator agent), with the classification justified." \
 --ac "Each traditional-code dependency is named for in-tree integration with a concrete current candidate identified by research." \
 --ac "Each non-traditional dependency has a corresponding wpm-installer-package task in this backlog rather than a direct inline install." \
 --ac "The five ownership modes (managed, local-external, remote-external, manual-BYO, disabled) are mapped onto each dependency for the reference profile." \
 --ac "For each dependency the seam it plugs into is stated, so an alternative can later replace it with no core change."

echo "== DEPENDENCIES (assembly reference) =="
mk DCEDAR "Integrate the Cedar policy engine" -l dependency,trad,impl --priority high --doc docs/components/admission-and-policy.md \
 -d "Why: admission needs deterministic, forbid-wins policy evaluation, which Cedar provides as an in-tree library. Builds the integration behind the policy port. Depends on the dependency strategy and the kernel. Out of scope: the admission pipeline itself; authoring policies beyond what tests need." \
 --dep "${ID[F5]},${ID[F4]}" \
 --ac "Policy decisions are evaluated through the policy port, and the core calls the port without referencing the engine directly." \
 --ac "A request denied by any applicable policy is denied regardless of evaluation order." \
 --ac "Evaluating the same inputs twice yields the same decision." \
 --ac "A policy authoring or load error surfaces as a typed error and prevents evaluation rather than failing open." \
 --ac "Swapping the policy engine for another implementation of the port changes no core code."

mk WPM_BROWSER "Build a wpm installer package for the browser runtime" -l dependency,wpm,impl --priority high --doc docs/components/capsule.md --doc docs/components/worker-plane.md \
 -d "Why: the capsule needs a browser and automation engine (Chromium plus Playwright) on the operator host, which touches the host and therefore ships as a wpm installer package, not in-tree code or a prebuilt monolithic image. Produces the package as a Backlog.md task graph the operator agent runs. Depends on the dependency strategy. Out of scope: the capsule runtime that assembles this layer; the view stack and isolation, which are their own packages. Follow the task conventions for the package's own tasks." \
 --dep "${ID[F5]}" \
 --ac "A wpm installer package for the browser runtime exists in this project and is the unit that gets built, not an inline install." \
 --ac "The package detects whether a usable browser-plus-automation runtime is already present on the host before changing anything." \
 --ac "On completion the host can launch a headless browser driveable over a remote-control protocol." \
 --ac "An already-adequate runtime is left unchanged and recorded as such." \
 --ac "The package records a verifiable receipt of what it changed and is idempotent on re-run." \
 --ac "A host where the runtime cannot be installed surfaces a clear, catchable failure rather than a partial state."

mk WPM_VIEW "Build a wpm installer package for the human-view stack" -l dependency,wpm,impl --priority high --doc docs/components/capsule.md --doc docs/components/access-gateway.md \
 -d "Why: the human entrypoint needs a view stack (noVNC plus websockify plus a VNC server plus a virtual display) on the operator host; it touches the host, so it ships as a wpm installer package, separate from the browser layer. Depends on the dependency strategy. Out of scope: the browser-stream HumanEntrypoint provider that wires this stack into the capsule." \
 --dep "${ID[F5]}" \
 --ac "A wpm installer package for the human-view stack exists in this project and is the unit that gets built, not an inline install." \
 --ac "The package detects an existing usable view stack before changing anything." \
 --ac "On completion the host can expose a running browser display as a browser-reachable stream." \
 --ac "An already-adequate stack is left unchanged and recorded." \
 --ac "The package records a verifiable receipt and is idempotent on re-run." \
 --ac "A host where the stack cannot be installed fails clearly without leaving it half-configured."

mk WRUN "Build a wpm installer package for the capsule isolation runtime" -l dependency,wpm,impl --priority high --doc docs/components/worker-plane.md \
 -d "Why: capsules need an isolation runtime (a container or rootless runtime) on the operator host, which touches the host and ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA worker plane that uses the runtime; the launcher provider." \
 --dep "${ID[F5]}" \
 --ac "A wpm installer package for the isolation runtime exists in this project and is the unit that gets built, not an inline install." \
 --ac "The package detects whether a supported isolation runtime is already present and usable." \
 --ac "On completion the host can start an isolated capsule process the agent does not run as." \
 --ac "An already-present adequate runtime is left unchanged and recorded." \
 --ac "The package records a verifiable receipt and is idempotent on re-run." \
 --ac "A host where the runtime cannot be installed surfaces a catchable failure without partial state."

mk WEDGE "Build a wpm installer package for the edge proxy" -l dependency,wpm,impl --priority high --doc docs/components/access-gateway.md --doc docs/components/route-controller.md \
 -d "Why: the public entry needs an edge proxy in front of the operator host; it touches the host, so it ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA Access Gateway and Route controller that program it." \
 --dep "${ID[F5]}" \
 --ac "A wpm installer package for the edge proxy exists in this project and is the unit that gets built, not an inline install." \
 --ac "The package detects an existing usable edge proxy before changing anything." \
 --ac "On completion the host has an edge proxy able to terminate inbound connections and forward to a local upstream." \
 --ac "An already-adequate proxy is left unchanged and recorded." \
 --ac "The package records a verifiable receipt and is idempotent on re-run." \
 --ac "A host where the proxy cannot be provisioned fails clearly without leaving a half-configured proxy."

mk WIDP "Build a wpm installer package for the identity provider" -l dependency,wpm,impl --priority high --doc docs/components/identity-and-auth.md \
 -d "Why: enforcing recipient identity relies on a WebAuthn or passkey provider running as a host service, so it ships as a wpm installer package. Depends on the dependency strategy. Out of scope: the GLA Identity and Auth component that delegates to it; recipient enrollment, which uses it." \
 --dep "${ID[F5]}" \
 --ac "A wpm installer package for the identity provider exists in this project and is the unit that gets built, not an inline install." \
 --ac "The package detects an existing usable identity provider before changing anything." \
 --ac "On completion the host runs an identity provider that can register and verify a passkey or WebAuthn credential." \
 --ac "An already-adequate provider is left unchanged and recorded." \
 --ac "The package records a verifiable receipt and is idempotent on re-run." \
 --ac "A failure to provision surfaces a catchable error without leaving the provider partially configured."

echo "== ROW PAIRS =="
# ---- Phase E: enrollment (full build) ----
mk ENROLL_P "Plan the recipient-enrollment step" -l plan,architecture,row,enrollment --priority medium --doc docs/components/identity-and-auth.md --doc docs/components/access-gateway.md --doc docs/components/capability-service.md \
 -d "Why: every handoff assumes the recipient is already registered; this one-time, operator-run step establishes the credential and the recipient-identity binding before any handoff. Produces architecture and the build plan; no production code. Use the architect skills and research WebAuthn registration and invite flows on the internet. Depends on the contracts plan. Out of scope: implementing the step; the per-handoff verification, which is the auth step." \
 --dep "${ID[F3]}" \
 --ac "Identity and Auth's part is specified: how a credential is registered and stored bound to a recipient identity, establishing the initial auth strength, as a contract." \
 --ac "The Access Gateway's part is specified: how it fronts enrollment and admits the flow only on a verified single-use enrollment grant, so no public path bypasses grant verification." \
 --ac "The Capability service's part is specified: a single-use operator-discharge enrollment grant bound to the recipient, distinct from a handoff grant." \
 --ac "The Channel adapter's part is specified: how the enrollment invite reaches exactly the intended recipient." \
 --ac "The enrollment user experience is designed end to end: the invite, first-time registration, what the user sees on failure, and how recovery or re-enrollment is handled." \
 --ac "An implementation plan for the build task exists, with how enrolled-versus-not is observed from outside." \
 --ac "Dependencies are identified and classified; the identity provider is named, and any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The enrollment seam is specified at full capability so a different identity provider is added against it with no core change."
mk ENROLL_I "Enroll a recipient so they can later be verified" -l impl,row,enrollment --priority medium --doc docs/components/identity-and-auth.md --doc docs/components/access-gateway.md \
 -d "Why: delivers the precondition for every handoff, a recipient with a registered credential bound to their identity. Builds the step designed in its plan. Depends on the kernel, the identity provider, and the edge proxy. Out of scope: per-handoff verification." \
 --dep "${ID[F4]},${ID[WIDP]},${ID[WEDGE]}" \
 --ac "An invited recipient can register a credential, after which their identity carries a recorded auth strength." \
 --ac "Enrollment proceeds only when the single-use enrollment grant verifies; an absent, wrong-recipient, expired, or reused grant is refused." \
 --ac "After enrollment the recipient can be verified at a later handoff, and an un-enrolled recipient cannot." \
 --ac "A failed or abandoned registration leaves no half-bound identity and is safely retryable." \
 --ac "Swapping the identity provider for another that satisfies the seam changes no core code."

# ---- Phase 0: inbound + connect (full build) ----
mk INBOUND_P "Plan the inbound-request and agent-connect step" -l plan,architecture,row,inbound --priority medium --doc docs/components/channel-adapter.md --doc docs/components/agent-bridge.md \
 -d "Why: the flow starts when a human request arrives over a channel and the agent connects to GLA; this fixes the inbound seam and the agent-authority anchor. Produces architecture and the build plan; no code. Use the architect skills and research channel-ingress and agent-CLI connection patterns on the internet. Depends on the contracts plan. Out of scope: orientation reads; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Channel adapter's part is specified: how an inbound human message is delivered to the agent with its recipient binding attached, as a port the core depends on rather than a provider-specific call." \
 --ac "The Agent Bridge's part is specified: how the agent connects and obtains an agent-authority anchor that scopes its operations." \
 --ac "The Capability service's part is specified: how the agent-authority capability is issued without becoming something the agent can forge." \
 --ac "The operating experience of connecting is designed: how the agent discovers it is connected and what it is allowed to do." \
 --ac "An implementation plan for the build task exists, with how a delivered, recipient-bound, connected state is observed." \
 --ac "Dependencies are identified and classified; the channel client is named for in-tree integration, and any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The channel seam is specified at full capability so a second channel is added as a provider with no seam change."
mk INBOUND_I "Receive a request and connect the agent" -l impl,row,inbound --priority medium --doc docs/components/channel-adapter.md --doc docs/components/agent-bridge.md \
 -d "Why: delivers the first observable behaviour, an inbound message reaching the agent and the agent connected with a scoped authority. Builds the step designed in its plan. Depends on the kernel. Out of scope: orientation reads." \
 --dep "${ID[F4]}" \
 --ac "An inbound message on the configured channel is delivered to the agent together with the recipient it is bound to." \
 --ac "On connecting, the agent receives an agent-authority anchor and the set of operations it allows." \
 --ac "Receiving and connecting change no task or session state." \
 --ac "Adding a second channel provider requires no change to how the agent receives messages."

# ---- Phase 1: orient (full build) ----
mk ORIENT_P "Plan the agent-orientation step" -l plan,architecture,row,orient --priority medium --doc docs/components/agent-bridge.md --doc docs/components/catalog.md --doc docs/05-cli-and-entities.md \
 -d "Why: before proposing anything the agent must discover what this install offers; this fixes the read surface. Produces architecture and the build plan; no code. Use the architect skills and research agent-CLI discovery and read-model patterns on the internet. Depends on the contracts plan. Out of scope: proposing a session; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Agent Bridge's read surface is specified: the whoami, template-show, and skill-show operations and their stable output shapes, as the single interface the agent reads through." \
 --ac "The Catalog's part is specified: how templates and skills available in this install are listed with system-derived availability, as a read contract." \
 --ac "The operating experience of orientation is designed: how the agent learns the holes it must fill without guessing them." \
 --ac "An implementation plan for the build task exists, with how orientation is observed end to end." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The catalog read seam is specified at full capability so a new template or skill source is added with no seam change."
mk ORIENT_I "Orient the agent against the install" -l impl,row,orient --priority medium --doc docs/components/agent-bridge.md --doc docs/05-cli-and-entities.md \
 -d "Why: delivers the agent's discovery of what this install can assemble. Builds the step designed in its plan. Depends on the kernel and the connect step. Out of scope: proposing a session." \
 --dep "${ID[F4]},${ID[INBOUND_I]}" \
 --ac "Asking who am I returns the agent's identity and the operations its authority allows, as JSON." \
 --ac "Showing a template returns its required parts and each backing dependency's binding status; an unknown id exits not-found." \
 --ac "Listing the catalog returns only entities available in this install, with availability derived by the system, not asserted by the caller." \
 --ac "Orientation operations change no server state."

# ---- Phase 2a: propose (full build) ----
mk PROPOSE_P "Plan the propose-task-and-session step" -l plan,architecture,row,propose --priority medium --doc docs/components/task-service.md --doc docs/components/capability-service.md --doc docs/04-capsule-assembly.md \
 -d "Why: the agent turns intent into a concrete proposal under a durable task; this fixes the task root and the proposal contract. Produces architecture and the build plan; no code. Use the architect skills and research durable-task and assembly-authoring patterns on the internet. Depends on the contracts plan. Out of scope: admission; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Task service's part is specified: how a task (explicit or implicit) is opened as the revocation, budget, and audit root, with its lifecycle." \
 --ac "The Capability service's part is specified: how a task capability is minted with the agent-authority as parent and narrower scope." \
 --ac "The Agent Bridge's part is specified: how a concrete assembly proposal plus the task capability is submitted, and what id is returned." \
 --ac "The operating experience is designed: how the agent composes a proposal from a template and learns of a malformed one before provisioning." \
 --ac "An implementation plan for the build task exists, with how an opened task and a submitted proposal are observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The task and proposal seams are specified at full capability so multi-session and other intents need no seam change."
mk PROPOSE_I "Open a task and submit a session proposal" -l impl,row,propose --priority medium --doc docs/components/task-service.md --doc docs/components/capability-service.md \
 -d "Why: delivers a durable task and an agent-authored proposal ready for admission. Builds the step designed in its plan. Depends on the kernel and orientation. Out of scope: admitting or provisioning." \
 --dep "${ID[F4]},${ID[ORIENT_I]}" \
 --ac "Creating a task returns a task id and mints a task capability whose scope is no broader than the agent-authority it descends from." \
 --ac "A single-capsule goal needs no explicit task: one is created implicitly." \
 --ac "A concrete assembly proposal can be submitted under a task and is acknowledged with a reference." \
 --ac "A proposal that does not conform to the assembly contract is rejected at submission with a typed error, before admission."

# ---- Phase 2b: admit (full build) ----
mk ADMIT_P "Plan the admit-the-proposal step" -l plan,architecture,row,admit --priority medium --doc docs/components/admission-and-policy.md --doc docs/04-capsule-assembly.md --doc docs/components/catalog.md \
 -d "Why: this is the gate from proposal to provisioning, the heart of agent-assembles, GLA-validates; it fixes the admission pipeline. Produces architecture and the build plan; no code. Use the architect skills and research admission-control patterns (mutate then validate, Cedar) on the internet. Depends on the contracts plan. Out of scope: provisioning; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "Admission's mutate-then-validate pipeline is specified: the defaults and mount canonicalization it applies, the offline checks it runs (policy, capability scope, catalog availability, recipient and identity, per-mount), and that it mints and runs nothing." \
 --ac "The Catalog availability check is specified as a contract: a referenced entity that is unavailable is a rejection." \
 --ac "The Capability scope check is specified: a proposal outside the presented capability's scope is rejected from the capability and request alone." \
 --ac "The Task dispatch is specified: an accepted proposal is dispatched to the task, with the reject path returning a stable namespaced code." \
 --ac "The operating experience is designed: how a dry-run and a stable rejection code let the agent recover without reading internals." \
 --ac "An implementation plan for the build task exists, with how acceptance and each rejection class are observed, and how dry-run matches the real run." \
 --ac "Dependencies are identified and classified; the policy engine is named as in-tree, and any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The admission stages and policy are specified at full capability so a new check or policy is added with no change to the pipeline contract."
mk ADMIT_I "Admit a session proposal" -l impl,row,admit --priority medium --doc docs/components/admission-and-policy.md --doc docs/04-capsule-assembly.md \
 -d "Why: delivers deterministic accept-or-reject from proposal to provisioning. Builds the step designed in its plan. Depends on the kernel, the policy engine, and the propose step. Out of scope: provisioning." \
 --dep "${ID[F4]},${ID[DCEDAR]},${ID[PROPOSE_I]}" \
 --ac "A proposal passing policy, capability scope, catalog availability, recipient and identity, and every per-mount check is accepted and dispatched to its task." \
 --ac "A proposal failing any one of those is rejected with a stable namespaced code and the documented exit code, and nothing is minted or run." \
 --ac "Mutation fills defaults and canonicalizes mount paths but never invents missing semantics; a missing required detail is a rejection, not a guess." \
 --ac "Mount and policy validation run offline, so a dry-run accept-or-reject matches the real run for the same spec." \
 --ac "Adding a new policy check changes no caller of admission."

# ---- Phase 3a: provision (full build) ----
mk PROVISION_P "Plan the provision-the-capsule step" -l plan,architecture,row,provision --priority medium --doc docs/components/session-service.md --doc docs/components/worker-plane.md --doc docs/components/capsule.md \
 -d "Why: this brings a live two-actor capsule into being for the whole task; it fixes the provisioning saga and the spawner seam. Produces architecture and the build plan; no code. Use the architect skills and research spawner and runtime-assembly models on the internet. The capsule is assembled from separate local layers, not one image. Depends on the contracts plan. Out of scope: the connector return and handoff; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Session service's create-saga is specified: the ordered steps to spawn a capsule and what is returned, reversible on failure, as a contract." \
 --ac "The Worker and spawner seam is specified: the abstract launcher interface, its tiers, and the per-launcher mount capability, so runtimes are pluggable." \
 --ac "The Capsule is specified as one shared state assembled from its separate layers, exposing surfaces over that state, with host paths mountable at the agent's authority." \
 --ac "The operating experience is designed: how the operator's runtime, browser, and view packages are assembled into a live capsule." \
 --ac "An implementation plan for the build task exists, with how a live, isolated capsule is observed." \
 --ac "Dependencies are identified and classified; the isolation runtime, browser runtime, and view stack are named as wpm-installer-package tasks in this backlog." \
 --ac "The spawner seam is specified at full capability so a new launcher tier is added with no change to session or capsule code."
mk PROVISION_I "Provision the live capsule" -l impl,row,provision --priority medium --doc docs/components/session-service.md --doc docs/components/worker-plane.md --doc docs/components/capsule.md \
 -d "Why: delivers a running, isolated capsule created under a task. Builds the step designed in its plan. Depends on the kernel, the isolation runtime, the browser runtime, the view stack, and admission. Out of scope: returning the connector to the agent; opening a human window." \
 --dep "${ID[F4]},${ID[WRUN]},${ID[WPM_BROWSER]},${ID[WPM_VIEW]},${ID[ADMIT_I]}" \
 --ac "Creating a session runs the saga and yields a live capsule under the task, assembled from the isolation, browser, and view layers." \
 --ac "The capsule runs isolated from the agent, and host paths the spec requested are present at their targets in the requested mode, only as the launcher's mount capability supports." \
 --ac "A saga failure midway leaves no orphaned capsule or workspace." \
 --ac "Swapping the launcher for another tier that satisfies the spawner seam changes no session or capsule code."

# ---- Phase 3b: connector (full build) ----
mk CONNECTOR_P "Plan the agent-connector step" -l plan,architecture,row,connector --priority medium --doc docs/components/capsule.md --doc docs/components/capability-service.md --doc docs/05-cli-and-entities.md \
 -d "Why: the agent needs an agent-blind handle to drive the capsule; this fixes the connector capability and its surface. Produces architecture and the build plan; no code. Use the architect skills and research control-protocol brokering on the internet. Depends on the contracts plan. Out of scope: the agent's actual driving; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Capability service's part is specified: how an agent-connector capability is minted as an agent-blind reference, never a raw secret." \
 --ac "The Session service's part is specified: how the session returns the connector reference to the agent after provisioning." \
 --ac "The Capsule's part is specified: the continuously-attached agent connector as a surface distinct from any human entrypoint." \
 --ac "The operating experience is designed: how the agent obtains and uses the connector without it ever exposing operator secrets." \
 --ac "An implementation plan for the build task exists, with how an attached, agent-blind connector is observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The connector seam is specified at full capability so a non-browser connector type is added with no seam change."
mk CONNECTOR_I "Return an agent-blind connector to the agent" -l impl,row,connector --priority medium --doc docs/components/capsule.md --doc docs/components/capability-service.md \
 -d "Why: delivers the agent's handle to drive the capsule without seeing secrets. Builds the step designed in its plan. Depends on the kernel and provisioning. Out of scope: the agent's driving actions; human windows." \
 --dep "${ID[F4]},${ID[PROVISION_I]}" \
 --ac "After provisioning, the session returns a connector reference for the live capsule." \
 --ac "The connector reference is agent-blind: it lets the agent drive the capsule without exposing any operator secret." \
 --ac "The connector stays attached across the session's life, independent of any human window." \
 --ac "Requesting the connector of a session with no live capsule surfaces a catchable conflict, not a crash."

# ---- Phase 4: drive (full build) ----
mk DRIVE_P "Plan the agent-drives-via-connector step" -l plan,architecture,row,drive --priority medium --doc docs/components/capsule.md --doc docs/components/agent-bridge.md --doc docs/05-cli-and-entities.md \
 -d "Why: between handoffs the agent works autonomously by driving the capsule over the connector; this fixes that work-channel seam, distinct from the control CLI. Produces architecture and the build plan; no code. Use the architect skills and research control-protocol tunnelling-versus-direct exposure on the internet. Depends on the contracts plan. Out of scope: human windows; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Agent Bridge's part is specified: it surfaces the connector as data and does not proxy the work itself through control verbs." \
 --ac "The Capsule's part is specified: the agent connector as a continuously-driveable surface separate from the human entrypoint." \
 --ac "The operating experience is designed: how the agent drives the page and observes results, with control and work kept separable." \
 --ac "An implementation plan for the build task exists, including whether connector traffic is tunnelled or a scoped route, and how driving is observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The connector is specified at full capability as one connector family so other connector types reuse the same seam."
mk DRIVE_I "Drive the capsule autonomously over the connector" -l impl,row,drive --priority medium --doc docs/components/capsule.md --doc docs/05-cli-and-entities.md \
 -d "Why: delivers the agent's autonomous work between handoffs. Builds the step designed in its plan. Depends on the kernel and the connector. Out of scope: opening or closing a human window." \
 --dep "${ID[F4]},${ID[CONNECTOR_I]}" \
 --ac "Given a live session, the agent can drive the capsule's browser (navigate, act, inspect) through the connector." \
 --ac "Driving occurs over the connector, not through control verbs, so control and work remain separable." \
 --ac "Driving works whether or not a human window is open." \
 --ac "A connector request against a session with no live capsule surfaces a catchable conflict, not a crash."

# ---- Phase 4 repeats (check) ----
mk DRIVE2_P "Plan any change for the second autonomous-drive pass" -l plan,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: a later phase drives the same capsule again to a different page; this is the same connector capability as the drive step. Confirm the existing architecture covers it and design only any delta; no production code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting the drive capability." \
 --dep "${ID[F3]}" \
 --ac "The drive-step architecture is confirmed to cover a second pass to a different page, or the specific delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience for this pass is designed; if none, that is recorded."
mk DRIVE2_I "Drive the capsule to a second page without rebuilding" -l impl,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: the agent must reach a different page on the same live capsule; reuse the drive build, do not rewrite it. Builds only the delta. Depends on the drive step. Out of scope: rebuilding the connector or drive capability." \
 --dep "${ID[DRIVE_I]}" \
 --ac "The agent reaches and acts on a second page on the same live capsule using the existing drive capability, with no rewrite of it." \
 --ac "Only the delta, if any, is added; the connector and capsule behave as in the first drive."

mk DRIVERES_P "Plan any change for driving while the session stays active" -l plan,check,row,drive --priority low --doc docs/components/session-service.md --doc docs/components/capsule.md \
 -d "Why: the agent resumes driving after a window closes while the session is active; this reuses the drive capability and the active-session state. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or session state." \
 --dep "${ID[F3]}" \
 --ac "The drive and session-active architecture is confirmed to cover resumed driving, or the specific delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience while resuming is designed; if none, that is recorded."
mk DRIVERES_I "Resume driving on an active session without rebuilding" -l impl,check,row,drive --priority low --doc docs/components/session-service.md \
 -d "Why: after a window closes the agent keeps driving the still-running capsule; reuse the existing builds, do not rewrite. Builds only the delta. Depends on the drive and connector steps. Out of scope: rebuilding drive or the connector." \
 --dep "${ID[DRIVE_I]},${ID[CONNECTOR_I]}" \
 --ac "With the session active and the capsule still running, the agent resumes driving using the existing capability, with no rewrite." \
 --ac "The capsule's state carries across the resume; only the delta, if any, is added."

# ---- Phase 5: handoff open (full build) ----
mk HANDOFF_P "Plan the open-a-recipient-bound-window step" -l plan,architecture,row,handoff --priority medium --doc docs/components/session-service.md --doc docs/components/route-controller.md --doc docs/components/access-gateway.md --doc docs/components/capability-service.md \
 -d "Why: this is the defining act, exposing the same live capsule to a bound human through a temporary window; it fixes the grant, route, gateway, and link-delivery seams. Produces architecture and the build plan; no code. Use the architect skills and research capability-grant and programmable-edge-routing patterns on the internet. Depends on the contracts plan. Out of scope: the user's authentication; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Agent Bridge's handoff-open operation is specified: its inputs (session, recipient, reason, TTL) and output (window id, link, expiry), as a contract." \
 --ac "The Session service's open-window orchestration is specified: mint a recipient-bound grant, program a route, deliver the link, as an ordered contract reversible on close." \
 --ac "The Capability service's part is specified: a short-TTL, single-recipient grant that narrows the connector and is never widened." \
 --ac "The Route controller's part is specified: programming a grant-bound route onto the gateway and reconciling it to session state." \
 --ac "The Access Gateway's part is specified as the sole public entry the route attaches to, with no agent path through it." \
 --ac "The Channel adapter's part is specified: delivering the recipient-bound link to exactly the bound recipient." \
 --ac "The recipient's user experience of receiving and opening the link is designed, including a forwarded or expired link." \
 --ac "An implementation plan for the build task exists covering first-open and re-open onto the same capsule, with how a reachable bound window is observed." \
 --ac "Dependencies are identified and classified; the edge proxy is named as a wpm-installer-package task in this backlog." \
 --ac "The route and grant seams are specified at full capability so a new gateway or channel is added with no change to session code."
mk HANDOFF_I "Open a recipient-bound handoff window onto the capsule" -l impl,row,handoff --priority medium --doc docs/components/session-service.md --doc docs/components/route-controller.md \
 -d "Why: delivers a temporary, recipient-bound surface onto the live capsule, and the ability to re-open one. Builds the step designed in its plan. Depends on the kernel, the edge proxy, provisioning, and the channel. Out of scope: the user proving identity." \
 --dep "${ID[F4]},${ID[WEDGE]},${ID[PROVISION_I]},${ID[INBOUND_I]}" \
 --ac "Opening a window mints a recipient-bound grant, programs a grant-bound route, and delivers a link to the bound recipient." \
 --ac "The window exposes the capsule's human entrypoint only while open; outside an open window there is nothing to reach." \
 --ac "The grant narrows authority to a single recipient and a short TTL and cannot be widened by the request." \
 --ac "A programming failure surfaces a typed error and the window does not open, leaving no partial route." \
 --ac "Adding a different edge gateway that satisfies the route seam changes no session code."

# ---- Phase 6: auth (full build) ----
mk AUTH_P "Plan the user-authenticates-at-the-edge step" -l plan,architecture,row,auth --priority medium --doc docs/components/access-gateway.md --doc docs/components/identity-and-auth.md --doc docs/components/capability-service.md --doc docs/components/route-controller.md \
 -d "Why: the bound human opens the link and proves identity to GLA before reaching the capsule; this fixes the edge auth-and-verify seam. Produces architecture and the build plan; no code. Use the architect skills and research WebAuthn verification and edge authorization on the internet. Depends on the contracts plan. Out of scope: the in-window work; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Access Gateway's entry contract is specified: it verifies the grant and requires the bound identity before forwarding anywhere." \
 --ac "Identity and Auth's verification contract is specified: how an auth strength is required and checked against the credential the recipient enrolled, delegating to the provider." \
 --ac "The Capability service's part is specified: the grant is verified statelessly at the edge and only the bound recipient passes." \
 --ac "The Route controller's part is specified: a verified request resolves to the capsule's human entrypoint; an unverified or expired one does not." \
 --ac "The recipient's authentication experience is designed, including that it depends on prior enrollment and what an un-enrolled or failed recipient sees." \
 --ac "An implementation plan for the build task exists, with how only-the-bound-authenticated-recipient-passes is observed." \
 --ac "Dependencies are identified and classified; the identity provider is named as a wpm-installer-package task in this backlog." \
 --ac "The auth seam is specified at full capability so a different identity provider or auth strength is added with no gateway-code change."
mk AUTH_I "Verify the bound recipient at the edge" -l impl,row,auth --priority medium --doc docs/components/access-gateway.md --doc docs/components/identity-and-auth.md \
 -d "Why: delivers edge enforcement, the right human proving identity before reaching anything. Builds the step designed in its plan. Depends on the kernel, the identity provider, the handoff step, and enrollment. Out of scope: the in-window work." \
 --dep "${ID[F4]},${ID[WIDP]},${ID[HANDOFF_I]},${ID[ENROLL_I]}" \
 --ac "Opening a valid link prompts for the required identity proof and verifies it against the recipient's enrolled credential." \
 --ac "A request without the required identity proof is refused at the edge." \
 --ac "A grant for a different recipient, or an expired or revoked grant, is refused and does not resolve onward." \
 --ac "An un-enrolled recipient cannot pass, with a catchable result rather than a crash." \
 --ac "Swapping the identity provider for another that satisfies the auth seam changes no gateway code."

# ---- Phase 6 continuation (check) ----
mk AUTHRET_P "Plan any change for returning the auth result to the gateway" -l plan,check,row,auth --priority low --doc docs/components/identity-and-auth.md \
 -d "Why: the verification result returns to the gateway as the leg that authorizes the entrypoint; this is part of the auth capability. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting verification." \
 --dep "${ID[F3]}" \
 --ac "The auth-step architecture is confirmed to cover returning the result and auth strength to the gateway, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the recipient's experience at this leg is designed; if none, that is recorded."
mk AUTHRET_I "Return the verification result to the gateway without rebuilding" -l impl,check,row,auth --priority low --doc docs/components/identity-and-auth.md \
 -d "Why: the gateway must act on the verifier's result; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step. Out of scope: rebuilding verification." \
 --dep "${ID[AUTH_I]}" \
 --ac "The verifier's result and auth strength reach the gateway and gate the entrypoint, using the existing auth build with no rewrite." \
 --ac "A failure result is conveyed as a refusal, not an unstructured error."

# ---- Phase 6 reach capsule (full build) ----
mk REACH_P "Plan the verified-human-reaches-the-capsule step" -l plan,architecture,row,reach --priority medium --doc docs/components/access-gateway.md --doc docs/components/capsule.md --doc docs/components/route-controller.md \
 -d "Why: after verification the human must reach the capsule's human entrypoint over a proxied connection; this fixes exposing the human surface in-window. Produces architecture and the build plan; no code. Use the architect skills and research authorized reverse-proxy upgrade patterns on the internet. Depends on the contracts plan. Out of scope: what the user does in-window; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Access Gateway's part is specified: how a verified, in-window request is proxied to the capsule's human entrypoint and nothing else." \
 --ac "The Capsule's part is specified: the human entrypoint as a surface exposed only within an open, authorized window." \
 --ac "The Route controller's part is specified: resolving the verified request to the correct capsule entrypoint." \
 --ac "The recipient's experience of arriving at the live surface is designed, including a connection that drops or a window that expires." \
 --ac "An implementation plan for the build task exists, with how a verified human reaching the live surface is observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The human-entrypoint seam is specified at full capability so a different view surface is added with no gateway-code change."
mk REACH_I "Let the verified human reach the capsule surface" -l impl,row,reach --priority medium --doc docs/components/access-gateway.md --doc docs/components/capsule.md \
 -d "Why: delivers the verified human arriving at the live human entrypoint. Builds the step designed in its plan. Depends on the kernel, the auth step, and provisioning. Out of scope: the user's in-window actions." \
 --dep "${ID[F4]},${ID[AUTH_I]},${ID[PROVISION_I]}" \
 --ac "A verified, in-window request is proxied to the capsule's human entrypoint." \
 --ac "The human entrypoint is reachable only within an open, authorized window and not otherwise." \
 --ac "When the grant is revoked or expires, the live connection is severed and the surface is no longer reachable." \
 --ac "Adding a different view surface that satisfies the entrypoint seam changes no gateway code."

# ---- Phase 7: fill (full build) ----
mk FILL_P "Plan the user-works-in-window-agent-blind step" -l plan,architecture,row,fill --priority medium --doc docs/components/capsule.md \
 -d "Why: inside the window the human acts on the live page, entering secrets the agent must never see; this fixes the agent-blind input path. Produces architecture and the build plan; no code. Use the architect skills and research input-isolation patterns on the internet. Depends on the contracts plan. Out of scope: completion detection; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Capsule's agent-blind input path is specified as an invariant: human keystrokes inside the window reach the website but never the agent connector." \
 --ac "The recipient's experience of working in the live page is designed, including that the agent cannot observe their secret entry." \
 --ac "An implementation plan for the build task exists, with how agent-blind human input is observed from outside." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The input path is specified at full capability so any human entrypoint upholds the same agent-blind guarantee."
mk FILL_I "Let the human work in-window without the agent seeing secrets" -l impl,row,fill --priority medium --doc docs/components/capsule.md \
 -d "Why: delivers the privacy-critical behaviour, the human entering secrets the agent cannot observe. Builds the step designed in its plan. Depends on the kernel and the reach step. Out of scope: detecting completion." \
 --dep "${ID[F4]},${ID[REACH_I]}" \
 --ac "Inside an open window the human can interact with the live page and submit the form." \
 --ac "Secret keystrokes reach the website and are never delivered to the agent connector." \
 --ac "Nothing the human types in the window appears in any agent-readable channel or log." \
 --ac "The agent-blind guarantee holds regardless of which human entrypoint surface is used."

# ---- Phase 7/8: detect (full build) ----
mk DETECT_P "Plan the detect-completion step" -l plan,architecture,row,detect --priority medium --doc docs/components/completion-service.md --doc docs/components/capsule.md --doc docs/components/session-service.md \
 -d "Why: the system must know when the human step is done; this fixes the completion-detection seam. Produces architecture and the build plan; no code. Use the architect skills and research completion-signal and detector-contract patterns on the internet. Depends on the contracts plan. Out of scope: closing the window; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Capsule's part is specified: it emits completion signals per its declared detectors and does not itself decide completion." \
 --ac "The Completion service's contract is specified: it validates a human done-signal against the detector contract and normalizes it to an envelope." \
 --ac "The Session service's part is specified: how a validated completion is received and routed to close the window." \
 --ac "The operating experience is designed: how the agent learns the step completed without seeing the secret." \
 --ac "An implementation plan for the build task exists, with how a validated done-signal and a non-firing detector are observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "The detector seam is specified at full capability so a new detector type is added with no capsule change."
mk DETECT_I "Detect completion of the human step" -l impl,row,detect --priority medium --doc docs/components/completion-service.md --doc docs/components/capsule.md \
 -d "Why: delivers a validated done-signal the agent can act on. Builds the step designed in its plan. Depends on the kernel and the fill step. Out of scope: closing the window and revoking." \
 --dep "${ID[F4]},${ID[FILL_I]}" \
 --ac "A configured detector fires when its observable condition is met, and the service validates the done-signal against its contract." \
 --ac "The capsule emits completion signals but does not itself decide completion." \
 --ac "A detector that never fires leads to window expiry rather than a false completion." \
 --ac "Adding a new detector type that satisfies the seam changes no capsule code."

# ---- Phase 8: close (full build) ----
mk CLOSE_P "Plan the close-the-window-and-resume step" -l plan,architecture,row,close --priority medium --doc docs/components/session-service.md --doc docs/components/route-controller.md --doc docs/components/capability-service.md --doc docs/components/completion-service.md \
 -d "Why: when the human finishes, the window must close cleanly and the agent resume on the same capsule; this fixes the close, revoke, and unmount contract. Produces architecture and the build plan; no code. Use the architect skills and research revocation-on-close and clean-teardown patterns on the internet. Depends on the contracts plan. Out of scope: full task teardown; implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The completion-to-close trigger is specified: a validated done-signal or expiry drives the window close, as a contract." \
 --ac "The Session service's close-window step is specified: it unmounts the route and revokes the grant and returns the session to active with the capsule still running." \
 --ac "The Capability service's part is specified: the grant no longer verifies after close and its live connection is force-closed." \
 --ac "The Route controller's part is specified: the route no longer resolves and the connection is severed." \
 --ac "The operating experience is designed: how the agent observes the window closed and itself resumed." \
 --ac "An implementation plan for the build task exists covering close-on-completion and close-on-expiry, with how window-closed, capsule-alive is observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "Close is specified at full capability as the reverse of open at the same seams, so it stays correct as gateways or channels are swapped."
mk CLOSE_I "Close the window and let the agent resume" -l impl,row,close --priority medium --doc docs/components/session-service.md --doc docs/components/route-controller.md \
 -d "Why: delivers a clean window close that revokes access while keeping the capsule for the agent. Builds the step designed in its plan. Depends on the kernel, the detect step, and the handoff step. Out of scope: tearing down the whole task." \
 --dep "${ID[F4]},${ID[DETECT_I]},${ID[HANDOFF_I]}" \
 --ac "On a validated completion the window closes: the route is unmounted and the grant is revoked." \
 --ac "After close the recipient's link no longer reaches the capsule and any live connection is force-closed." \
 --ac "The session returns to active and the capsule keeps running for the agent." \
 --ac "A window that expires without completion closes the same way, releasing the route and grant."

# ---- Phase 9-10 (check): inspect ----
mk INSPECT_P "Plan any change for the agent inspecting after the first window" -l plan,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: after the first window the agent inspects the page again via the connector; this is the drive capability resumed on an active session. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or resume." \
 --dep "${ID[F3]}" \
 --ac "The drive and resume architecture is confirmed to cover inspecting after a window closes, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience here is designed; if none, that is recorded."
mk INSPECT_I "Inspect after the first window without rebuilding" -l impl,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: the agent reads the post-submission page on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive and close steps. Out of scope: rebuilding drive." \
 --dep "${ID[DRIVE_I]},${ID[CLOSE_I]}" \
 --ac "After the first window closes the agent inspects the live page using the existing drive capability, with no rewrite." \
 --ac "The capsule's state from the first window is intact for the inspection."

# ---- Phase 11 (check): handoff 2 ----
mk HANDOFF2_P "Plan the re-open-onto-the-same-capsule delta" -l plan,check,row,handoff --priority low --doc docs/components/session-service.md \
 -d "Why: the second handoff re-opens a window on the same live capsule; this reuses the handoff-open capability and adds only the re-open-without-respawn behaviour. Confirm coverage and design the delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting handoff open." \
 --dep "${ID[F3]}" \
 --ac "The handoff-open architecture is confirmed to cover re-opening onto the same capsule, or the re-open delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the recipient's experience for the second link is designed; if none, that is recorded."
mk HANDOFF2_I "Re-open a window onto the same capsule without rebuilding" -l impl,check,row,handoff --priority low --doc docs/components/session-service.md \
 -d "Why: a second window must open onto the same capsule with no re-spawn; reuse the handoff build, do not rewrite. Builds only the delta. Depends on the handoff step. Out of scope: rebuilding window open." \
 --dep "${ID[HANDOFF_I]}" \
 --ac "A second window re-opens onto the same live capsule with no re-spawn, using the existing handoff capability." \
 --ac "The second link is bound to the recipient and short-TTL exactly as the first." \
 --ac "The earlier window's closure left nothing that blocks the re-open."

# ---- Phase 12 (check): auth reused ----
mk AUTH2_P "Plan the auth-reused-on-re-open delta" -l plan,check,row,auth --priority low --doc docs/components/identity-and-auth.md \
 -d "Why: on the second window the recipient's prior authentication is reused without a fresh prompt where the design allows; this reuses the auth capability and adds only the reuse behaviour. Confirm coverage and design the delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting verification." \
 --dep "${ID[F3]}" \
 --ac "The auth architecture is confirmed to cover reusing a still-valid authentication, or the reuse delta is specified; nothing already covered is re-specified." \
 --ac "The reuse experience is designed: when no re-prompt occurs and when re-auth is still required." \
 --ac "Any change to the recipient's experience is designed; if none, that is recorded."
mk AUTH2_I "Reuse valid authentication on the second window without rebuilding" -l impl,check,row,auth --priority low --doc docs/components/identity-and-auth.md \
 -d "Why: a returning recipient with valid auth should not be re-prompted; reuse the auth build, do not rewrite. Builds only the delta. Depends on the auth step and the re-open delta. Out of scope: rebuilding verification." \
 --dep "${ID[AUTH_I]},${ID[HANDOFF2_I]}" \
 --ac "On the second window a recipient whose authentication is still valid reaches the capsule with no fresh prompt." \
 --ac "If the authentication is no longer valid, a re-prompt occurs rather than silent access." \
 --ac "Reuse is confined to the bound recipient and does not widen access."

mk AUTH2REACH_P "Plan any change for reaching the capsule on the reused-auth window" -l plan,check,row,reach --priority low --doc docs/components/access-gateway.md \
 -d "Why: after reused auth the recipient reaches the same capsule entrypoint; this is the reach capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting reach." \
 --dep "${ID[F3]}" \
 --ac "The reach architecture is confirmed to cover the reused-auth window, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the recipient's experience here is designed; if none, that is recorded."
mk AUTH2REACH_I "Reach the capsule on the reused-auth window without rebuilding" -l impl,check,row,reach --priority low --doc docs/components/access-gateway.md \
 -d "Why: the returning recipient reaches the same live entrypoint; reuse the reach build, do not rewrite. Builds only the delta. Depends on the reach step and the reused-auth delta. Out of scope: rebuilding reach." \
 --dep "${ID[REACH_I]},${ID[AUTH2_I]}" \
 --ac "The reused-auth request is proxied to the same capsule human entrypoint using the existing reach capability." \
 --ac "Outside the open second window the entrypoint remains unreachable."

# ---- Phase 12 (check): fill code ----
mk FILL2_P "Plan any change for the human entering the verification code" -l plan,check,row,fill --priority low --doc docs/components/capsule.md \
 -d "Why: in the second window the human enters a code agent-blind; this is the in-window agent-blind capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting the input path." \
 --dep "${ID[F3]}" \
 --ac "The agent-blind input architecture is confirmed to cover entering a code, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the recipient's experience here is designed; if none, that is recorded."
mk FILL2_I "Let the human enter the code agent-blind without rebuilding" -l impl,check,row,fill --priority low --doc docs/components/capsule.md \
 -d "Why: the human enters the verification code in the second window without the agent seeing it; reuse the fill build, do not rewrite. Builds only the delta. Depends on the fill step. Out of scope: rebuilding the input path." \
 --dep "${ID[FILL_I]}" \
 --ac "In the second window the human enters the code, which reaches the website and never the agent connector, using the existing agent-blind capability." \
 --ac "The code does not appear in any agent-readable channel or log."

# ---- Phase 13 (check): completion 2 ----
mk DETECT2_P "Plan any change for detecting the second completion" -l plan,check,row,detect --priority low --doc docs/components/completion-service.md \
 -d "Why: the second step completes when a detector matches; this is the detection capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting detection." \
 --dep "${ID[F3]}" \
 --ac "The detection architecture is confirmed to cover the second completion, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience here is designed; if none, that is recorded."
mk DETECT2_I "Detect the second completion without rebuilding" -l impl,check,row,detect --priority low --doc docs/components/completion-service.md \
 -d "Why: the second human step must be detected as done; reuse the detect build, do not rewrite. Builds only the delta. Depends on the detect step. Out of scope: rebuilding detection." \
 --dep "${ID[DETECT_I]}" \
 --ac "The second completion is detected and validated using the existing detection capability, with no rewrite." \
 --ac "A non-firing detector leads to expiry, not a false completion."

mk CLOSE2_P "Plan any change for closing the second window" -l plan,check,row,close --priority low --doc docs/components/session-service.md \
 -d "Why: the second window closes the same way as the first; this is the close capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting close." \
 --dep "${ID[F3]}" \
 --ac "The close architecture is confirmed to cover the second window, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience here is designed; if none, that is recorded."
mk CLOSE2_I "Close the second window without rebuilding" -l impl,check,row,close --priority low --doc docs/components/session-service.md \
 -d "Why: the second window must close, revoke, and unmount like the first; reuse the close build, do not rewrite. Builds only the delta. Depends on the close step. Out of scope: rebuilding close." \
 --dep "${ID[CLOSE_I]}" \
 --ac "The second window closes, revoking its grant and unmounting its route, using the existing close capability." \
 --ac "The session returns to active and the capsule keeps running after the second close."

# ---- Phase 14 (check): configure ----
mk CONFIG_P "Plan any change for the agent configuring the account" -l plan,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: after verification the agent configures the account via the connector; this is the drive capability again. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive." \
 --dep "${ID[F3]}" \
 --ac "The drive architecture is confirmed to cover configuring the account, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience here is designed; if none, that is recorded."
mk CONFIG_I "Configure the account over the connector without rebuilding" -l impl,check,row,drive --priority low --doc docs/components/capsule.md \
 -d "Why: the agent sets up the fresh account on the still-running capsule; reuse the drive build, do not rewrite. Builds only the delta. Depends on the drive step. Out of scope: rebuilding drive." \
 --dep "${ID[DRIVE_I]}" \
 --ac "The agent configures the account on the live capsule using the existing drive capability, with no rewrite." \
 --ac "The session's logged-in state from the handoffs is intact for the configuration."

mk CONFRES_P "Plan any change for resuming after configuration" -l plan,check,row,drive --priority low --doc docs/components/session-service.md \
 -d "Why: the agent drives and the session stays active through configuration; this reuses drive and active-session state. Confirm coverage and design only any delta; no code. Use the architect skills. Depends on the contracts plan. Out of scope: re-architecting drive or session state." \
 --dep "${ID[F3]}" \
 --ac "The drive and active-session architecture is confirmed to cover this pass, or the delta is specified; nothing already covered is re-specified." \
 --ac "Any change to the operating experience here is designed; if none, that is recorded."
mk CONFRES_I "Keep the session active through configuration without rebuilding" -l impl,check,row,drive --priority low --doc docs/components/session-service.md \
 -d "Why: the session must remain active while the agent configures; reuse the existing builds, do not rewrite. Builds only the delta. Depends on the drive and connector steps. Out of scope: rebuilding drive or the connector." \
 --dep "${ID[DRIVE_I]},${ID[CONNECTOR_I]}" \
 --ac "The session stays active and the capsule keeps running through configuration, using the existing capability with no rewrite." \
 --ac "Only the delta, if any, is added."

# ---- Phase 15: teardown (full build) ----
mk TEARDOWN_P "Plan the tear-down-the-session step" -l plan,architecture,row,teardown --priority medium --doc docs/components/session-service.md --doc docs/components/task-service.md --doc docs/components/worker-plane.md --doc docs/components/capability-service.md \
 -d "Why: completing the task must destroy the capsule and revoke every capability, leaving nothing live; this fixes the teardown contract and the cleanup guarantee. Produces architecture and the build plan; no code. Use the architect skills and research idempotent cleanup and reconciler patterns on the internet. Depends on the contracts plan. Out of scope: implementing the step." \
 --dep "${ID[F3]}" \
 --ac "The Task service's complete-or-revoke contract is specified: a terminal transition that drives teardown of its sessions and capsules and revokes descendant capabilities." \
 --ac "The Session service's teardown is specified: session to completed and capsule reaped, as an ordered contract." \
 --ac "The Capability service's part is specified: every descendant capability stops verifying after teardown." \
 --ac "The Worker plane's part is specified: capsule and workspace destroyed and a reconciler confirms no orphans, distinguishing ephemeral state from persisted host paths." \
 --ac "The Route controller's part is specified: no live route remains after completion." \
 --ac "The operating experience is designed: how the agent and operator observe that nothing live remains." \
 --ac "An implementation plan for the build task exists covering normal completion and abort, with how no-live-state-remains is observed." \
 --ac "Dependencies are identified and classified; any non-traditional one has a wpm-installer-package task in this backlog." \
 --ac "Cleanup is specified at full capability to reconcile by state regardless of launcher, so new runtimes are torn down by the same reconciler."
mk TEARDOWN_I "Tear down the session and revoke everything" -l impl,row,teardown --priority medium --doc docs/components/session-service.md --doc docs/components/task-service.md --doc docs/components/worker-plane.md \
 -d "Why: delivers the closing guarantee, completing the task leaves no live capsule, route, grant, or runtime. Builds the step designed in its plan. Depends on the kernel, provisioning, the propose step, the handoff step, and the close step. Out of scope: the end-to-end pass." \
 --dep "${ID[F4]},${ID[PROVISION_I]},${ID[PROPOSE_I]},${ID[HANDOFF_I]},${ID[CLOSE_I]}" \
 --ac "Completing the task transitions the session to completed and reaps its capsule and workspace." \
 --ac "Every capability descended from the task no longer verifies after teardown." \
 --ac "No live route or grant remains for the torn-down session." \
 --ac "Ephemeral capsule state is destroyed while host paths the agent mounted and persisted outputs survive on the host." \
 --ac "A cleanup reconciler confirms no orphaned runtime remains, and re-running teardown is idempotent." \
 --ac "Aborting instead of completing performs the same teardown to a non-success terminal state."

echo "== E2E =="
mk E2E "Pass the scenario-01 through-case end to end" -l e2e,impl --priority high --doc docs/01-architecture-overview.md --doc docs/05-cli-and-entities.md --doc docs/scenario-01-unified.html \
 -d "Why: the MVP is defined by the full scenario-01 thread working through the real modules, proving the slice and the horizontal-extension property. Composes the implemented steps; adds no new module behaviour. Depends on every full-build step. Out of scope: any second provider per family, which is the later horizontal extension this MVP enables." \
 --dep "${ID[ENROLL_I]},${ID[INBOUND_I]},${ID[ORIENT_I]},${ID[PROPOSE_I]},${ID[ADMIT_I]},${ID[PROVISION_I]},${ID[CONNECTOR_I]},${ID[DRIVE_I]},${ID[HANDOFF_I]},${ID[AUTH_I]},${ID[REACH_I]},${ID[FILL_I]},${ID[DETECT_I]},${ID[CLOSE_I]},${ID[TEARDOWN_I]}" \
 --ac "From a single channel request, given an enrolled recipient, the agent orients, proposes, and provisions a live capsule under a task." \
 --ac "The agent drives the capsule to the form, opens a recipient-bound window, and the bound human authenticates and completes the form without the agent seeing the secret." \
 --ac "A second window re-opens onto the same capsule, the human's auth is reused, and the verification-code step completes." \
 --ac "Completing the task tears everything down, leaving no live capsule, route, grant, or runtime." \
 --ac "Throughout, every cross-module call goes over the designed seams: no core module imports a concrete adapter." \
 --ac "Swapping any single provider the slice uses (channel, launcher, gateway, identity, view, detector) for a compatible one needs no core code change."

echo
echo "== SUMMARY =="
backlog task list --plain 2>/dev/null | tail -n +1 | wc -l
echo "tasks created above"
