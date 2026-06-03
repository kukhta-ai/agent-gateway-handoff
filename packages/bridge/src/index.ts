// @gla/bridge — edge ring (baseline §1).
// The Agent Bridge core (components/agent-bridge.md): the agent's single door to GLA — a trust
// boundary, a protocol adapter, and a read/delivery surface, holding NO cognition and enforcing
// nothing on its own (it is a thin transport over the control plane).
// Slice 1 — orientation read surface (scenario-01 Phase 1) + connect (the agent-authority anchor):
//   connect()         → trigger→admit→anchor: issue the agent-authority anchor (capability svc)
//   whoami()          → identity + allowed ops, by VERIFYING the anchor (never trusting bytes)
//   templateList/Show → the assemblable menu + each part's backing dependency binding status
//   skillList/Show    → procedural knowledge ; catalogList → only available entities (system-derived)
// Slice 2 — propose + admit (scenario-01 Phase 2; GLA-018/019/020/021):
//   taskCreate/Get/List → open a Task + mint its `task` capability (attenuated from agent-authority)
//   sessionCreate       → resolve task → ADMIT (mutate→validate) → dry-run accept/reject OR dispatch a
//                         Session in `issued` (no spawn — Slice 3) ; sessionGet/List
// Reads are side-effect-free; the Bridge enforces NOTHING itself — admission/policy/capability are
// server-side (docs/05 §1). It routes ops to the injected Task/Session/Admission services.
//
// Boundary: `bridge` is edge — it imports CORE/CORE-ADJACENT GLA packages (@gla/capability,
// @gla/catalog, @gla/task, @gla/session, @gla/admission) + @gla/kernel, NEVER an adapter. In
// particular it NEVER imports @gla/policy-cedar: `app` injects the Cedar PolicyPort into the
// AdmissionService it hands the bridge (the import-boundary lint proves this).

import { AdmissionService, type AdmitResult, type AssemblyProposal } from "@gla/admission";
import {
  type AuthorityProfile,
  CapabilityService,
  type MintedAuthority,
  type WhoamiResult,
} from "@gla/capability";
import {
  type Availability,
  CatalogService,
  type IndexedEntity,
  type TemplateShowResult,
  toAdmissionCatalog,
} from "@gla/catalog";
import {
  type Capability,
  HmacCapabilitySigner,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
  type TaskId,
  glaError,
} from "@gla/kernel";
import {
  type HandoffView,
  type ProvisionResult,
  SessionService,
  type SessionView,
} from "@gla/session";
import { type CreateTaskInput, TaskService, type TaskView } from "@gla/task";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const BRIDGE_MODULE = "@gla/bridge" as const;
/** Ring classification from the architecture baseline (informational). */
export const BRIDGE_RING = "edge" as const;

/**
 * A read-only snapshot of the task/session aggregate stores, so a caller (and a test) can assert
 * that connect + orient **change no task or session state** (GLA-015 AC#3, GLA-017 AC#4). Slice 1
 * has no Task/Session services yet; this is the minimal observable seam — the Bridge holds it but
 * never writes through it on a read path. A later slice injects the real stores.
 */
export interface StateStores {
  /** A stable, comparable snapshot of task+session state (Slice 1: empty/opaque). */
  snapshot(): { tasks: unknown[]; sessions: unknown[] };
}

/** The default no-op state stores — empty task/session state the read surface never mutates. */
export const EMPTY_STATE: StateStores = {
  snapshot: () => ({ tasks: [], sessions: [] }),
};

/** What the agent receives on connect: the anchor token + the operations it allows (GLA-015 AC#2). */
export interface ConnectResult {
  /** The agent-authority anchor (the bearer the agent holds; never raw signing material). */
  token: OpaqueToken;
  /** The agent's identity (from the anchor). */
  identity: string;
  /** The matched AuthorityProfile name. */
  authority_profile: string;
  /** The set of operations the anchor allows (the `allowed-ops` caveat). */
  allowed_ops: string[];
}

/** Construction options for the Agent Bridge. */
export interface AgentBridgeOptions {
  /** The catalog read service (defaults to the in-tree reference-slice catalog). */
  catalog?: CatalogService;
  /**
   * The shared capability SIGNER underpinning the agent-authority anchor, the task cap, and (in the
   * provisioning composition) the connector cap. Inject it when the `capability` + `task` services were
   * built with this same signer, so the bridge VERIFIES presented caps with the key that minted them
   * (and the lineage cascade across all three holds). Defaults to a fresh signer wired to the defaults.
   */
  signer?: HmacCapabilitySigner;
  /** The capability service that mints/verifies the anchor (defaults to a fresh one over {@link signer}). */
  capability?: CapabilityService;
  /** The local AuthorityProfile the anchor is minted from (local single-operator default). */
  profile?: AuthorityProfile;
  /** The task/session state stores (read-only here); defaults to empty. */
  state?: StateStores;
  /** The Task service (Slice 2; defaults to one sharing the capability signer). */
  task?: TaskService;
  /** The Session service (Slice 2; defaults to a fresh one). */
  session?: SessionService;
  /**
   * Whether the injected SessionService is wired to PROVISION (Slice 3): `app` passes `true` when it
   * injects a SessionService with the real worker/connector deps, so `session create` runs the spawn
   * saga and returns `{capsule, connector}`. Default `false` — a bare bridge dispatches a Session in
   * `issued` (no spawn), the Slice-2 behaviour.
   */
  provisioning?: boolean;
  /**
   * The Admission service (Slice 2). `app` injects one wired with the **real Cedar** PolicyPort
   * (the bridge/CLI never import `@gla/policy-cedar` — boundary). When omitted, the bridge builds a
   * default admission over a permissive ALLOW-ALL PolicyPort (so a standalone bridge supports orient
   * + the permit path); the structural checks (catalog/config/mount) still hold. The catastrophic
   * mount denylist also still holds. A deny *policy* outcome requires the Cedar-wired admission.
   */
  admission?: AdmissionService;
}

/**
 * The bridge's DEFAULT permissive PolicyPort — allow-all (the local operator's own agent may propose;
 * baseline §5). This is NOT Cedar: it is a tiny inline stub so a standalone bridge has a working
 * policy seam without importing an adapter (the boundary lint forbids the edge from importing
 * `@gla/policy-cedar`). `app` injects the real Cedar adapter behind the same `PolicyPort`.
 */
const ALLOW_ALL_POLICY = {
  evaluate: () => ({ decision: "permit" as const, reasons: [] }),
};

/** The default local single-operator AuthorityProfile (baseline §5: agent auth deferred). */
export const DEFAULT_LOCAL_PROFILE: AuthorityProfile = {
  profile: "local-single-operator",
  identity: "agent:local",
  allowedOps: [
    "whoami",
    "catalog.list",
    "template.list",
    "template.show",
    "skill.list",
    "skill.show",
    "task.create",
    "session.create",
    "handoff.open",
    "handoff.wait",
    "task.complete",
  ],
};

/**
 * The Agent Bridge core. A thin transport: it anchors the agent (via the capability service) and
 * serves read-models (via the catalog service); it decides nothing and enforces nothing itself
 * (components/agent-bridge.md invariants). In the local profile the agent is not authenticated
 * (baseline §5) — connect anchors the authority with no credential.
 */
export class AgentBridge {
  private readonly catalog: CatalogService;
  private readonly capability: CapabilityService;
  private readonly profile: AuthorityProfile;
  private readonly state: StateStores;
  private readonly task: TaskService;
  private readonly session: SessionService;
  private readonly admission: AdmissionService;
  /** Whether the SessionService is wired to provision (Slice 3) — set by `app`. */
  private readonly provisioningWired: boolean;
  /** The shared capability signer (so the task cap attenuates from the SAME-signed agent anchor). */
  private readonly signer: HmacCapabilitySigner;

  constructor(opts: AgentBridgeOptions = {}) {
    // A single shared signer underpins the capability service AND the task service, so a `task`
    // capability genuinely attenuates from the agent-authority token this bridge mints (verify works
    // across both). `app` may INJECT that signer (when it also injects `capability`/`task` built with
    // it) so the bridge verifies presented caps with the same key that minted them — and the connector
    // cap's lineage cascade across anchor→task→connector holds. Else a fresh signer wires the defaults.
    this.signer = opts.signer ?? new HmacCapabilitySigner();
    this.catalog = opts.catalog ?? new CatalogService();
    this.capability = opts.capability ?? new CapabilityService(this.signer);
    this.profile = opts.profile ?? DEFAULT_LOCAL_PROFILE;
    this.state = opts.state ?? EMPTY_STATE;
    this.task = opts.task ?? new TaskService({ capability: this.signer });
    this.session = opts.session ?? new SessionService();
    this.provisioningWired = opts.provisioning ?? false;
    this.admission =
      opts.admission ??
      new AdmissionService({
        policy: ALLOW_ALL_POLICY,
        catalog: toAdmissionCatalog(this.catalog),
      });
  }

  /**
   * Connect the agent (components/agent-bridge.md "trigger → admit → anchor"). In the local profile
   * there is no credential to verify (baseline §5); the Bridge admits the connection and asks the
   * Capability service to mint the `agent-authority` anchor from the matched AuthorityProfile. The
   * agent receives the anchor AND the set of operations it allows (GLA-015 AC#2). Changes no
   * task/session state (AC#3).
   */
  async connect(): Promise<ConnectResult> {
    const minted: MintedAuthority = await this.capability.mintAgentAuthority(this.profile);
    // Resolve back through verify() so what we hand the agent is exactly what a later whoami reads.
    const who = this.capability.whoami(minted.token);
    return {
      token: minted.token,
      identity: who.identity,
      authority_profile: who.authority_profile,
      allowed_ops: who.allowed_ops,
    };
  }

  /**
   * `whoami` (docs/05 §2, GLA-017 AC#1): the agent's identity + the operations its authority allows,
   * resolved by VERIFYING the anchor token (a tampered/forged/revoked token is rejected with the
   * kernel's typed error). Read-only. Returns the JSON the CLI prints.
   */
  whoami(token: OpaqueToken): WhoamiResult {
    return this.capability.whoami(token);
  }

  /** `template list` (docs/05): the assemblable capsule templates from the catalog index. Read-only. */
  templateList(filter?: { available?: boolean }): IndexedEntity[] {
    const f: { kind: string; available?: boolean } =
      filter?.available !== undefined
        ? { kind: "template", available: filter.available }
        : { kind: "template" };
    return this.catalog.list(f);
  }

  /**
   * `template show <id>` (docs/05, GLA-017 AC#2): required parts + each backing dependency's binding
   * status. Throws the kernel `catalog.unknown` (→ exit 5) for an unknown id. Read-only.
   */
  templateShow(id: string): TemplateShowResult {
    return this.catalog.templateShow(id);
  }

  /** `skill list` (docs/05): registered skills, optionally `--for` a template. Read-only. */
  skillList(filter?: { for?: string }): Array<{ id: string; for?: string }> {
    return this.catalog.skillList(filter);
  }

  /** `skill show <id>` (docs/05): the SKILL.md body. Throws `catalog.unknown` (→ exit 5). Read-only. */
  skillShow(id: string): { id: string; for?: string; body: string } {
    return this.catalog.skillShow(id);
  }

  /**
   * `catalog list [--kind --available]` (docs/05, GLA-017 AC#3): entities available in this install,
   * availability SYSTEM-DERIVED (never caller-asserted). Read-only.
   */
  catalogList(filter?: { kind?: string; available?: boolean }): IndexedEntity[] {
    return this.catalog.list(filter);
  }

  /**
   * A point-in-time snapshot of task/session state, so a caller can assert orientation changed
   * nothing (GLA-015 AC#3, GLA-017 AC#4). The Bridge never writes through this on a read path.
   */
  stateSnapshot(): { tasks: unknown[]; sessions: unknown[] } {
    return this.state.snapshot();
  }

  // ── Propose + admit (Slice 2, docs/05 §3 task/session) ─────────────────────────────────────────

  /**
   * `task create [--intent --recipient]` (docs/05; GLA-018/019): open a Task and mint its `task`
   * capability (parent = agent-authority, attenuated). Connects to anchor the agent-authority, then
   * delegates to the Task service. Accepts plain CLI strings (the `recipient` brand cast is this
   * boundary). Returns the public task view `{task_id, state:active, …}`.
   */
  async taskCreate(input: { intent?: string; recipient?: string }): Promise<TaskView> {
    const connected = await this.connect();
    const createInput: CreateTaskInput = {};
    if (input.intent !== undefined) {
      createInput.intent = input.intent;
    }
    if (input.recipient !== undefined) {
      createInput.recipient = input.recipient as RecipientRef;
    }
    const { task } = await this.task.create(createInput, connected.token);
    return TaskService.toView(task);
  }

  /** `task get <id>` (docs/05): read one Task aggregate. Throws `state.not_found` (→ exit 5). */
  taskGet(id: string): TaskView {
    return TaskService.toView(this.task.get(id as TaskId));
  }

  /** `task list [--state]` (docs/05): list Tasks visible to this authority. Read-only. */
  taskList(filter?: { state?: string }): TaskView[] {
    const f =
      filter?.state !== undefined ? { state: filter.state as TaskView["state"] } : undefined;
    return this.task.list(f).map(TaskService.toView);
  }

  /**
   * `session create ( -f <spec> | --template <id> [parts…] ) [--task <id>] [--mount …] [--dry-run]`
   * (docs/05; GLA-020/021). The propose→admit flow:
   *   1. resolve the presented capability + the proposal's task binding:
   *        - `--task <id>`: present that task's (scoped) capability and bind the proposal to it;
   *        - no `--task`: present the agent-authority (unscoped) and DO NOT create a task yet — an
   *          implicit task is opened ONLY on a real-run accept (so a reject/dry-run leaks no orphan
   *          task or capability — the §5 fix);
   *   2. ADMIT (mutate→validate) — mints/runs nothing;
   *   3. on REJECT → throw the typed error (the CLI maps `.code` → its exit code); nothing persisted;
   *   4. on a DRY-RUN accept → return `{decision:"accept", …}` (nothing provisioned, no task created);
   *   5. on a REAL accept → for the implicit case, open the task NOW; then DISPATCH: create the Session
   *      under the task in `issued` (no spawn — Slice 3), return `{session_id, state:"issued", task_id}`.
   * Dry-run and a real run share the identical admit pipeline (GLA-021 AC#4).
   */
  async sessionCreate(args: {
    proposal: CliAssemblyProposal;
    task?: string;
    dryRun?: boolean;
  }): Promise<SessionCreateResult> {
    // The CLI hands a plain-string proposal; the `recipient` brand cast is this single boundary.
    const recipient = args.proposal.recipient as RecipientRef;
    const dryRun = args.dryRun ?? false;

    // 1) Resolve the presented capability + the proposal's task binding.
    //    EXPLICIT task: present its scoped cap and bind metadata.task.
    //    IMPLICIT task: present the agent-authority (unscoped) and leave the proposal UNBOUND — the
    //    task is created only on a real-run accept (no orphan on reject/dry-run).
    let explicitTaskId: TaskId | undefined;
    let presented: Capability;
    const proposalBase: AssemblyProposal = { ...args.proposal, recipient };
    if (args.task !== undefined) {
      const t = this.task.get(args.task as TaskId); // throws state.not_found (→ exit 5) if unknown
      explicitTaskId = t.id;
      presented = this.presentTaskCapability(t.id);
      proposalBase.task = t.id;
    } else {
      // Present the agent-authority anchor (unscoped → no /task scope to violate). No task minted yet.
      const connected = await this.connect();
      presented = this.resolveAuthority(connected.token);
    }

    // 2) ADMIT (mutate→validate). Mints/runs nothing.
    const result: AdmitResult = this.admission.admit(proposalBase, presented, { dryRun });

    // 3) Reject → throw the typed error (the CLI maps the code → exit 3/4/5/7/8). Nothing persisted.
    if (result.decision === "reject") {
      throw glaError(result.error.code, result.error.message, {
        ...(result.error.detail !== undefined ? { detail: result.error.detail } : {}),
        retryable: result.error.retryable,
      });
    }

    // 4) Dry-run accept → report acceptance; provision NOTHING and create NO task. `task_id` is
    //    included only when an EXPLICIT task was given (no implicit task is opened on a dry-run).
    if (dryRun) {
      return explicitTaskId !== undefined
        ? { decision: "accept", dry_run: true, task_id: explicitTaskId }
        : { decision: "accept", dry_run: true };
    }

    // 5) Real accept → ensure a task (open the implicit one NOW, only on accept), then DISPATCH.
    let taskId: TaskId;
    if (explicitTaskId !== undefined) {
      taskId = explicitTaskId;
    } else {
      const connected = await this.connect();
      const created = await this.task.createImplicit(
        recipient,
        connected.token,
        args.proposal.intent,
      );
      taskId = created.task.id;
    }
    const session = this.session.createFromAdmitted(taskId, result.resolved);
    this.task.attachSession(taskId, session.id);

    // 6) PROVISION (Slice 3, GLA-022/023/024/025): run the reversible create-saga — spawn the capsule
    //    and mint the agent-blind connector, moving the session `issued → active`. On a provision
    //    failure the saga compensates (no orphan) and the session is `failed`; the typed error is
    //    re-thrown for the CLI to map to its exit code (3..8). When provisioning is not wired (a bare
    //    bridge with no worker), fall back to the Slice-2 `issued` dispatch result (no spawn).
    if (!this.provisioningWired) {
      return {
        decision: "accept",
        dry_run: false,
        session_id: session.id,
        state: session.state,
        task_id: taskId,
      };
    }
    const provisioned = await this.session.provision(session.id);
    return {
      decision: "accept",
      dry_run: false,
      session_id: provisioned.session_id,
      state: provisioned.state,
      task_id: taskId,
      capsule: provisioned.capsule,
      connector: provisioned.connector,
    };
  }

  /**
   * `session connector <id>` (docs/05; GLA-025): re-emit the agent-connector for a LIVE capsule so a
   * crashed agent re-attaches its CDP client. Prints a `secret_ref`, never a raw secret. A session with
   * no live capsule throws `state.conflict` (→ exit 7), NOT a crash (GLA-025 AC#4). Read-only.
   */
  async sessionConnector(id: string): Promise<ProvisionResult> {
    return this.session.connector(id as SessionView["session_id"]);
  }

  /** `session get <id>` (docs/05): read one Session. Throws `state.not_found` (→ exit 5). */
  sessionGet(id: string): SessionView {
    return SessionService.toView(this.session.get(id as SessionView["session_id"]));
  }

  /** `session list [--task --state]` (docs/05): list sessions. Read-only. Accepts plain CLI strings. */
  sessionList(filter?: { task?: string; state?: string }): SessionView[] {
    const f: { task?: TaskId; state?: SessionView["state"] } = {};
    if (filter?.task !== undefined) {
      f.task = filter.task as TaskId;
    }
    if (filter?.state !== undefined) {
      f.state = filter.state as SessionView["state"];
    }
    return this.session.list(f).map(SessionService.toView);
  }

  // ── Handoff (Slice 4b, docs/05 §3 handoff) ─────────────────────────────────────────────────────

  /**
   * `handoff open --session <id> [--reason --recipient --ttl]` (docs/05; GLA-032/033): open a recipient-bound
   * window onto a live session — the open-window saga (mint grant -> program route -> deliver link). Returns
   * `{handoff_id, link, recipient, expires_at}`. A session with no live capsule throws `state.conflict` (exit 7);
   * a saga step failure throws the typed error (the CLI maps `.code` -> its exit code).
   */
  async handoffOpen(args: {
    session: string;
    reason?: string;
    recipient?: string;
    ttl?: string;
  }): Promise<HandoffView> {
    const opts: { recipient?: RecipientRef; reason?: string; ttl?: string } = {};
    if (args.reason !== undefined) {
      opts.reason = args.reason;
    }
    if (args.recipient !== undefined) {
      opts.recipient = args.recipient as RecipientRef;
    }
    if (args.ttl !== undefined) {
      opts.ttl = args.ttl;
    }
    return this.session.openHandoff(args.session as SessionView["session_id"], opts);
  }

  /**
   * `handoff wait <id> [--timeout]` (docs/05; GLA-032/042): BLOCK until the human completes the window or it
   * expires. **On a validated COMPLETION (Slice 5)** it RETURNS the normalized completion envelope —
   * `{status, result?, next?}` (the Completion service validated the human's done-signal; scenario-01 Phase 8/13).
   * **On a cancel/expiry/timeout** it throws `auth.expired`, which the wait surface maps to **exit 6** (the window
   * closed WITHOUT a validated completion — a non-firing detector TTL-expires, GLA-043 AC#3). It polls the window
   * state on an interval, so a crashed agent can re-issue the wait and re-attach. Read-only long-poll.
   *
   * @param id        the handoff window id
   * @param timeoutMs the per-call deadline in ms (defaults to the window's own TTL via its `expires_at`)
   */
  async handoffWait(id: string, timeoutMs?: number): Promise<HandoffWaitResult> {
    const windowId = id as HandoffView["handoff_id"];
    // Resolve the deadline: the explicit timeout, else the window's own TTL.
    const view = this.session.handoffGet(windowId); // throws state.not_found (exit 5) if unknown
    const ttlDeadline = Date.parse(view.expires_at);
    const deadline =
      timeoutMs !== undefined
        ? Date.now() + timeoutMs
        : Number.isNaN(ttlDeadline)
          ? Date.now() + 15 * 60_000
          : ttlDeadline;

    const POLL_MS = 50;
    // Block until the window leaves `open`, or the deadline passes.
    for (;;) {
      const w = this.session.handoffGet(windowId);
      if (w.state === "completed") {
        // RETURN the validated completion envelope (Slice 5): {status, result?, next?}. The window closed by a
        // Completion-service-validated done-signal — the agent learns the step completed (without the secret).
        const result: HandoffWaitResult = {
          handoff_id: windowId,
          status: w.completion?.status ?? "completed",
          state: w.state,
        };
        if (w.completion?.result !== undefined) {
          result.result = w.completion.result;
        }
        if (w.completion?.next !== undefined) {
          result.next = w.completion.next;
        }
        return result;
      }
      if (w.state === "cancelled" || w.state === "expired") {
        // The window closed without a validated completion -> a wait timeout/expiry (exit 6 at the surface).
        throw glaError(
          "auth.expired",
          `handoff window "${windowId}" closed (${w.state}) before completion`,
          {
            detail: { id: windowId, state: w.state },
            retryable: false,
          },
        );
      }
      if (Date.now() >= deadline) {
        // The wait timed out while the window was still open -> exit 6.
        throw glaError("auth.expired", `handoff wait timed out for "${windowId}"`, {
          detail: { id: windowId },
          retryable: false,
        });
      }
      await delay(POLL_MS);
    }
  }

  /** `handoff get <id>` (docs/05): read one window's state. Throws `state.not_found` (exit 5). Read-only. */
  handoffGet(id: string): HandoffView {
    return this.session.handoffGet(id as HandoffView["handoff_id"]);
  }

  /** `handoff list [--session <id>]` (docs/05): list windows, optionally for a session. Read-only. */
  handoffList(filter?: { session?: string }): HandoffView[] {
    const f =
      filter?.session !== undefined
        ? { session: filter.session as SessionView["session_id"] }
        : undefined;
    return this.session.handoffList(f);
  }

  /** `handoff cancel <id>` (docs/05; GLA-033): close the window early (revoke grant, force-close WS, unmount route). */
  async handoffCancel(id: string): Promise<HandoffView> {
    return this.session.cancelHandoff(id as HandoffView["handoff_id"]);
  }

  /**
   * Resolve a task's `task` capability into a verified {@link Capability} to present to admission. The
   * task cap carries a `scope` caveat `/task/<id>`, so it is verified WITH that scope path (the
   * presenter exercising its own task path). A task with no stored token (shouldn't happen in this
   * flow) yields a minimal agent-authority-less capability that fails the scope check closed.
   */
  private presentTaskCapability(taskId: TaskId): Capability {
    const token = this.task.capabilityToken(taskId);
    if (token === undefined) {
      throw glaError("auth.insufficient", `no task capability for "${taskId}"`);
    }
    const verified = this.signer.verify(token, {
      now: new Date().toISOString() as Iso8601,
      revocations: this.signer.revocationSnapshot(),
      scopePath: `/task/${taskId}`,
    });
    if (!verified.ok) {
      throw glaError(verified.reason, `task capability rejected: ${verified.reason}`);
    }
    return verified.capability;
  }

  /**
   * Resolve the agent-authority anchor token into a verified {@link Capability} to present to
   * admission for the IMPLICIT-task path. The anchor is unscoped (no `/task` scope caveat), so the
   * capability-scope check has nothing to violate (the agent is authorized to open a new implicit
   * task). Verified through the kernel `verify()` (never trusting unsigned bytes).
   */
  private resolveAuthority(token: OpaqueToken): Capability {
    const verified = this.signer.verify(token, {
      now: new Date().toISOString() as Iso8601,
      revocations: this.signer.revocationSnapshot(),
    });
    if (!verified.ok) {
      throw glaError(verified.reason, `agent-authority rejected: ${verified.reason}`);
    }
    return verified.capability;
  }
}

/**
 * The CLI-friendly assembly proposal (plain `recipient: string`; the bridge brand-casts it). It is
 * the {@link AssemblyProposal} minus the bound `task` (the bridge sets that) and with a plain-string
 * recipient — so the CLI never has to handle the kernel's branded types.
 */
export interface CliAssemblyProposal extends Omit<AssemblyProposal, "task" | "recipient"> {
  recipient: string;
}

/** The result of `session create` (docs/05 §4): a dry-run accept, a real accept (with the session), or — */
/** on reject — the bridge throws the typed GlaError instead (the CLI maps `.code` → its exit code). */
export type SessionCreateResult =
  // Dry-run accept: nothing provisioned and NO task created — so `task_id` is present only when an
  // EXPLICIT `--task` was given (the implicit task is opened only on a real-run accept; the §5 fix).
  | { decision: "accept"; dry_run: true; task_id?: TaskId }
  | {
      decision: "accept";
      dry_run: false;
      session_id: string;
      state: string;
      task_id: TaskId;
      // PROVISIONED (Slice 3): the live capsule + the agent-blind connector, present when the bridge is
      // wired to provision (`app` injects the worker). Absent on a bare bridge (Slice-2 `issued` dispatch).
      capsule?: ProvisionResult["capsule"];
      connector?: ProvisionResult["connector"];
    };

/**
 * What `handoff wait` RETURNS when the window completes WITH a validated completion (Slice 5) — the normalized
 * envelope `{status, result?, next?}` (docs/05 `handoff wait`). `status` is the stable envelope status
 * ("submitted"/"verified"); `result` is the detector-shaped data; `next` is the optional multi-step hint. A
 * cancel/expire/timeout throws `auth.expired` (exit 6) instead of returning.
 */
export interface HandoffWaitResult {
  handoff_id: HandoffView["handoff_id"];
  /** The completion status — the stable envelope status ("submitted"/"verified"), from the Completion service. */
  status: string;
  /** The window state at return (`completed`). */
  state: HandoffView["state"];
  /** The detector-shaped completion result (validated against the contract), when the envelope carries one. */
  result?: Record<string, unknown>;
  /** An optional multi-step hint from the envelope (e.g. "email-verification"), when present. */
  next?: string;
}

/** Sleep `ms` (the handoff-wait long-poll interval). Unref'd so it never keeps the process alive on its own. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") {
      t.unref();
    }
  });
}

/** Re-export the kernel error helper so the CLI can build taxonomy errors without re-importing. */
export { glaError };
export type { Availability, IndexedEntity, TemplateShowResult, WhoamiResult };
export type { AuthorityProfile, MintedAuthority } from "@gla/capability";
export type { HandoffView, ProvisionResult } from "@gla/session";
