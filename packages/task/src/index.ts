// @gla/task — core ring (baseline §1, components/task-service.md, GLA-018/019).
// The Task aggregate's source of truth: the multi-step goal that gives a user coherent progress and
// an agent durable resume across sessions (the revocation/budget/audit root). The TaskService:
//   - create({intent?, recipient?}, agentAuthorityToken) → opens a Task and **mints a `task`
//     capability by ATTENUATING the agent-authority** (child ⊆ parent, NARROWER scope) — the task's
//     capability descends from agent-authority (kernel-contracts.md §2.1, task-service.md invariant).
//   - get / list — read the aggregate.
//   - implicit task — `session create` without `--task` auto-creates a real, single-session task
//     (task-service.md "Decisions": optional & implicit) so audit/resume still work.
// Lifecycle is the kernel Task state machine (`taskTransition`); the service never reimplements it.
//
// Boundary (core ring): depends ONLY on @gla/kernel — the Capability primitive is the kernel
// `CapabilityPort` SEAM (it never names a signer adapter). `app` injects the concrete signer.

import {
  type CapabilityPort,
  type Caveat,
  type Iso8601,
  type OpaqueToken,
  type RecipientRef,
  type Ref,
  type Task,
  type TaskId,
  type TaskState,
  glaError,
  taskTransition,
} from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const TASK_MODULE = "@gla/task" as const;
/** Ring classification from the architecture baseline (informational). */
export const TASK_RING = "core" as const;

/** A monotonic clock + id seam so the service stays pure/testable (no ambient Date/random in logic). */
export interface TaskClock {
  /** Current instant as ISO-8601. */
  now(): Iso8601;
}

/** The default wall-clock. */
export const SYSTEM_CLOCK: TaskClock = { now: () => new Date().toISOString() as Iso8601 };

/** Inputs the agent supplies to open a Task — all cognition (intent label + the bound recipient). */
export interface CreateTaskInput {
  /** Opaque intent label — agent cognition, never parsed by the system. */
  intent?: string;
  /** The recipient bound from the channel (narrow-only, never invented). */
  recipient?: RecipientRef;
  /** True when auto-created by `session create` without `--task` (an implicit single-session task). */
  implicit?: boolean;
}

/** The public Task view the Bridge/CLI emit (no capability token — the agent holds the anchor). */
export interface TaskView {
  task_id: TaskId;
  state: TaskState;
  intent?: string;
  recipient?: RecipientRef;
  sessions: string[];
  implicit: boolean;
  created_at: Iso8601;
  updated_at: Iso8601;
}

/** What `create` hands back: the Task and the minted (attenuated) task-capability token. */
export interface CreatedTask {
  task: Task;
  /** The `task` capability token — attenuated from the agent-authority (child ⊆ parent). */
  taskCapabilityToken: OpaqueToken;
}

/** Options for {@link TaskService}. */
export interface TaskServiceOptions {
  /** The kernel capability port that mints/attenuates (default: caller must inject; no signer named here). */
  capability: CapabilityPort;
  clock?: TaskClock;
  /** Id generator seam (default: a process-local counter + random suffix). */
  newTaskId?: () => TaskId;
}

let taskCounter = 0;
function defaultTaskId(): TaskId {
  taskCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `task_${rand}${taskCounter.toString(36)}`;
}

/**
 * The Task service (components/task-service.md). Owns the in-memory Task store, the lifecycle, and the
 * `task`-capability mint. It mints the task capability by **attenuating** the agent-authority token —
 * proving the task cap is a strict child of the agent's authority (kernel-contracts.md §2.2). The
 * narrowing it adds:
 *   - a `scope` caveat `"/task/<id>"` — a NEW dimension the agent-authority did not constrain, so it
 *     only narrows further (the task cap is bound to this task's path);
 *   - a `task-scoped allowed-ops` SUBSET (⊆ the agent-authority's ops) — never an added op.
 * `CapabilityPort.attenuate` rejects any widening, so a mis-built attenuation throws
 * `auth.attenuation_widened` rather than minting a broader child.
 */
export class TaskService {
  private readonly port: CapabilityPort;
  private readonly clock: TaskClock;
  private readonly newTaskId: () => TaskId;
  private readonly tasks = new Map<TaskId, Task>();
  /** The task-capability token per task (the service holds it to revoke/cascade later). */
  private readonly tokens = new Map<TaskId, OpaqueToken>();

  constructor(opts: TaskServiceOptions) {
    this.port = opts.capability;
    this.clock = opts.clock ?? SYSTEM_CLOCK;
    this.newTaskId = opts.newTaskId ?? defaultTaskId;
  }

  /**
   * Open a Task and mint its `task` capability (docs/05 `task create`; GLA-018 #1, GLA-019). The task
   * capability is **attenuated from the agent-authority** (child ⊆ parent, narrower scope) — the
   * load-bearing invariant the test asserts. The Task starts `active` (the kernel lifecycle's initial
   * state). `taskCapabilityRef` records the minted capability's id as an opaque `Ref<"task">`.
   *
   * @param input  intent/recipient/implicit (all cognition)
   * @param agentAuthorityToken  the agent's root anchor — the parent the task cap attenuates from
   * @throws GlaErrorException (`auth.*`) if the agent-authority token is malformed or the attenuation
   *         would widen authority (it never can for a correct narrowing).
   */
  async create(input: CreateTaskInput, agentAuthorityToken: OpaqueToken): Promise<CreatedTask> {
    const id = this.newTaskId();
    const at = this.clock.now();

    // ATTENUATE the agent-authority → a strictly-narrower `task` capability (child ⊆ parent).
    // The added caveats only ever narrow: a task-scoped path (a new dimension) + a task op-subset.
    const added: Caveat[] = [
      { kind: "scope", path: `/task/${id}` },
      { kind: "allowed-ops", ops: TASK_SCOPED_OPS },
    ];
    let minted: { capability: { id: string }; token: OpaqueToken };
    try {
      minted = await this.port.attenuate(agentAuthorityToken, added);
    } catch (e) {
      // A widening or a malformed parent surfaces as the kernel's typed auth error — re-thrown as-is
      // so the Bridge maps it to exit 4. (Never silently mint a broader child.)
      throw e instanceof Error
        ? e
        : glaError("auth.insufficient", "failed to mint task capability from agent-authority");
    }

    const task: Task = {
      id,
      state: "active",
      sessions: [],
      stepCounters: { opened: 0, completed: 0 },
      taskCapabilityRef: minted.capability.id as Ref<"task">,
      createdAt: at,
      updatedAt: at,
      implicit: input.implicit ?? false,
    };
    if (input.intent !== undefined) {
      task.intentLabel = input.intent;
    }
    if (input.recipient !== undefined) {
      task.recipient = input.recipient;
    }

    this.tasks.set(id, task);
    this.tokens.set(id, minted.token);
    return { task, taskCapabilityToken: minted.token };
  }

  /**
   * Auto-create an **implicit single-session task** for a `session create` with no `--task`
   * (task-service.md "optional & implicit"). A real Task object with an id, so audit/resume still
   * work — just flagged `implicit`. Carries the recipient through from the proposal.
   */
  async createImplicit(
    recipient: RecipientRef | undefined,
    agentAuthorityToken: OpaqueToken,
    intent?: string,
  ): Promise<CreatedTask> {
    const input: CreateTaskInput = { implicit: true };
    if (recipient !== undefined) {
      input.recipient = recipient;
    }
    if (intent !== undefined) {
      input.intent = intent;
    }
    return this.create(input, agentAuthorityToken);
  }

  /** Read one Task aggregate (docs/05 `task get`). Throws `state.not_found` (→ exit 5) if unknown. */
  get(id: TaskId): Task {
    const t = this.tasks.get(id);
    if (t === undefined) {
      throw glaError("state.not_found", `unknown task: "${id}"`, { detail: { id } });
    }
    return t;
  }

  /** Read one Task as the public view, or undefined if unknown (for callers that branch themselves). */
  tryGet(id: TaskId): Task | undefined {
    return this.tasks.get(id);
  }

  /** List Tasks, optionally filtered by state (docs/05 `task list [--state]`). Read-only. */
  list(filter?: { state?: TaskState }): Task[] {
    let rows = [...this.tasks.values()];
    if (filter?.state !== undefined) {
      rows = rows.filter((t) => t.state === filter.state);
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /**
   * Attach a session id to a task's ordered chain and bump the `opened` counter (called by the
   * Session service / admission dispatch on accept). Validates the task is still `active` (a terminal
   * task rejects new sessions with `state.conflict`). Returns the updated task.
   */
  attachSession(id: TaskId, sessionId: string): Task {
    const t = this.get(id);
    if (t.state !== "active") {
      throw glaError("state.conflict", `cannot add a session to a ${t.state} task`, {
        detail: { id, state: t.state },
      });
    }
    // biome-ignore lint/suspicious/noExplicitAny: SessionId brand cast from the dispatcher's string id
    t.sessions.push(sessionId as any);
    t.stepCounters.opened += 1;
    t.updatedAt = this.clock.now();
    return t;
  }

  /** Drive a Task one transition (kernel reducer); throws `state.conflict` on an illegal move. */
  transition(id: TaskId, to: TaskState): Task {
    const t = this.get(id);
    t.state = taskTransition(t.state, to);
    t.updatedAt = this.clock.now();
    return t;
  }

  /** The minted task-capability token for a task (held by the service), or undefined. */
  capabilityToken(id: TaskId): OpaqueToken | undefined {
    return this.tokens.get(id);
  }

  /** Project a Task to the public CLI/Bridge view (docs/05 §4 shape). */
  static toView(t: Task): TaskView {
    const view: TaskView = {
      task_id: t.id,
      state: t.state,
      sessions: [...t.sessions],
      implicit: t.implicit,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    };
    if (t.intentLabel !== undefined) {
      view.intent = t.intentLabel;
    }
    if (t.recipient !== undefined) {
      view.recipient = t.recipient;
    }
    return view;
  }
}

/**
 * The operation set a `task` capability is scoped to — a strict SUBSET of the agent-authority's ops
 * (`DEFAULT_LOCAL_PROFILE.allowedOps`). A task acts on sessions/handoffs under its goal; it never
 * needs the orientation/whoami ops. Keeping this a subset is what makes the attenuation a genuine
 * narrowing (child ⊆ parent) on the ops dimension as well as the scope dimension.
 */
export const TASK_SCOPED_OPS: string[] = [
  "session.create",
  "handoff.open",
  "handoff.wait",
  "task.complete",
];
