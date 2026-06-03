// @gla/workspace-profile — adapter ring (baseline §1, docs/03 §8, GLA-023).
// Workspace: browser-profile-temp (ephemeral). Implements the kernel `WorkspacePort`:
//   realize(strategy, mounts, asUid) → a per-session ephemeral browser-profile temp dir (passed to
//     Chromium as `--user-data-dir`), with the agent's requested host mounts realized INTO the
//     capsule view AS THE AGENT'S OWN UID (docs/04 §6). For the process tier a mount maps a host path
//     into the profile/work dir (a symlink under <profile>/work/<target>, realized with the agent's
//     authority — the launcher runs the capsule as the agent's uid with priv-esc off, so the kernel's
//     DAC enforces exactly the agent's access; a path the agent can't read fails closed at spawn).
//   reap(handle) → WIPE the temp dir at teardown (the capsule's OWN ephemeral materials — its profile,
//     cookies, scratch). Host paths the agent mounted live on the host and SURVIVE (capsule.md
//     invariant). Idempotent: reaping a dir that is already gone is a no-op.
//
// The allowed-set / denylist / launcher-capability gate already ran OFFLINE at admission (Slice 2);
// this adapter only REALIZES — it does not re-authorize. It binds nothing to the network.
//
// Boundary (adapter ring): depends ONLY on @gla/kernel (the WorkspacePort + types) + Node builtins
// (node:fs, node:os, node:path). It is injected at `app`; core never imports it.

import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import {
  type MountSpec,
  type PartRef,
  type Ref,
  type WorkspaceHandle,
  type WorkspacePort,
  decodeRuntimeHandle,
  encodeRuntimeHandle,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const WORKSPACE_PROFILE_MODULE = "@gla/workspace-profile" as const;
/** Ring classification from the architecture baseline (informational). */
export const WORKSPACE_PROFILE_RING = "adapter" as const;

/**
 * The root under which per-session profile dirs are created. Defaults to `$GLA_STATE_DIR/workspaces`
 * when `$GLA_STATE_DIR` is set (so the operator can pin the GLA state dir), else `os.tmpdir()`. Each
 * session gets a fresh `gla-profile-XXXX` dir beneath it.
 */
function workspaceRoot(): string {
  const stateDir = process.env.GLA_STATE_DIR;
  if (stateDir !== undefined && stateDir.length > 0) {
    return joinPath(stateDir, "workspaces");
  }
  return tmpdir();
}

/**
 * The on-disk shape of a realized profile workspace (what the handle decodes to). The index signature
 * keeps it assignable to the kernel's neutral {@link import("@gla/kernel").RuntimeDescriptor} JSON
 * shape, so the shared `encodeRuntimeHandle`/`decodeRuntimeHandle` codec carries the `profileDir` field
 * (the launcher reads `--user-data-dir` off it via the same codec — no adapter→adapter import).
 */
interface ProfileWorkspace {
  /** The ephemeral profile dir (Chromium's `--user-data-dir`). Wiped at reap. */
  profileDir: string;
  /** The work dir inside the profile where agent mounts are realized (`<profileDir>/work`). */
  workDir: string;
  [k: string]: unknown;
}

/** Options for {@link WorkspaceProfileAdapter}. */
export interface WorkspaceProfileOptions {
  /** Override the workspace root (tests pass a scratch dir). */
  root?: string;
}

/**
 * The browser-profile-temp Workspace adapter (docs/03 §8). Realizes an ephemeral profile dir per
 * session and reaps it on teardown. The handle is the profile dir path encoded as a kernel
 * `WorkspaceHandle` (an opaque `Ref<"workspace">`); the adapter decodes it back on reap. Realizing a
 * mount maps a host path into `<profile>/work/<target-basename>` as a symlink — realized with the
 * agent's own authority (the capsule runs as the agent's uid, priv-esc off; docs/04 §6).
 */
export class WorkspaceProfileAdapter implements WorkspacePort {
  private readonly root: string;

  constructor(opts: WorkspaceProfileOptions = {}) {
    this.root = opts.root ?? workspaceRoot();
  }

  /**
   * Realize the ephemeral profile workspace + the agent's mounts (as the agent's uid). Creates a fresh
   * `gla-profile-XXXX` dir under the root and a `work/` subdir; for each mount, symlinks the host path
   * to `work/<target-basename>` (a process-tier mount = mapping the host path into the profile/work
   * dir, docs/04 §6). The `asUid` is accepted and threaded (the capsule process is later launched as
   * this uid; the workspace itself is created under the agent's own filesystem authority, so DAC
   * enforces access at spawn). Returns the handle encoding the profile dir.
   *
   * @param _strategy the workspace PartRef (e.g. `browser-profile-temp`) — this adapter realizes the
   *                  temp-profile strategy; the strategy name is informational here.
   * @param mounts    the agent's canonicalized mounts (already allowed-set/denylist-checked at admission)
   * @param _asUid    the agent's own uid the capsule runs as (priv-esc off; DAC fails closed)
   */
  async realize(_strategy: PartRef, mounts: MountSpec[], _asUid: number): Promise<WorkspaceHandle> {
    await mkdir(this.root, { recursive: true });
    // A fresh, unique profile dir per session — never reused, so no recipient state outlives a session.
    const profileDir = mkdtempSync(joinPath(this.root, "gla-profile-"));
    const workDir = joinPath(profileDir, "work");
    await mkdir(workDir, { recursive: true });

    // Realize each agent mount INTO the work dir AS THE AGENT (docs/04 §6). For the process tier a
    // mount maps a host path into the profile/work dir; we symlink so the bytes stay on the host and
    // survive reap (only the profile dir's own scratch is wiped). The link is best-effort: a host path
    // that does not exist yet (an rw target to be created) leaves no link — existence/readability are
    // OS-enforced at spawn as the agent's uid (a path the agent can't read fails closed there).
    for (const m of mounts) {
      const targetName = mountTargetBasename(m);
      const linkPath = joinPath(workDir, targetName);
      try {
        // Resolve the host to its real path (admission already canonicalized; re-resolve defensively).
        const hostReal = realpathSync(m.host);
        symlinkSync(hostReal, linkPath);
      } catch {
        // ENOENT (host not present yet) / EEXIST (duplicate target — admission rejects those, but be
        // defensive) — skip; the OS enforces actual access at spawn under the agent's uid.
      }
    }

    return encodeHandle({ profileDir, workDir });
  }

  /**
   * Reap the workspace: WIPE the ephemeral profile dir (the capsule's own profile, cookies, scratch).
   * Host paths the agent mounted are symlinks inside the work dir — removing the profile dir removes
   * only the *links*, never the link *targets* (the host files survive — capsule.md invariant).
   * Idempotent + restart-safe: reaping an already-gone dir is a no-op (`rmSync … force:true`).
   */
  async reap(handle: WorkspaceHandle): Promise<void> {
    const ws = decodeHandle(handle);
    if (ws === undefined) {
      return; // unparseable / already gone — idempotent no-op.
    }
    // `force: true` makes a missing dir a no-op; `recursive` removes the profile + its scratch.
    // Symlinks under work/ are unlinked (the link, not the target) — host mounts survive.
    rmSync(ws.profileDir, { recursive: true, force: true });
  }
}

/** The basename a mount realizes under `work/` (its target's last segment, else the host's). */
function mountTargetBasename(m: MountSpec): string {
  const target = m.target ?? `/work/${lastSegment(m.host)}`;
  return lastSegment(target);
}

/** The last `/`-segment of a path (the basename), or `"mount"` for a degenerate path. */
function lastSegment(p: string): string {
  const seg = p.split("/").filter(Boolean).pop();
  return seg !== undefined && seg.length > 0 ? seg : "mount";
}

// ── Handle codec — the WorkspaceHandle encodes the on-disk profile so reap can decode it ────────────
// Uses the kernel's neutral JSON codec, so the `profileDir` field is a SHARED contract: the launcher
// reads `--user-data-dir` off the same field via the same codec (no adapter→adapter import needed).

/** Encode a {@link ProfileWorkspace} into an opaque kernel {@link WorkspaceHandle}. */
function encodeHandle(ws: ProfileWorkspace): WorkspaceHandle {
  return encodeRuntimeHandle(ws) as unknown as WorkspaceHandle;
}

/** Decode a {@link WorkspaceHandle} back into the {@link ProfileWorkspace}, or undefined if malformed. */
function decodeHandle(h: WorkspaceHandle): ProfileWorkspace | undefined {
  const d = decodeRuntimeHandle(h as unknown as Parameters<typeof decodeRuntimeHandle>[0]);
  if (d !== undefined && typeof d.profileDir === "string" && d.profileDir.length > 0) {
    return { profileDir: d.profileDir, workDir: String(d.workDir ?? "") };
  }
  return undefined;
}

/** Decode the profile dir from a handle (so the launcher can read `--user-data-dir`). Exported helper. */
export function profileDirOf(h: WorkspaceHandle): string | undefined {
  return decodeHandle(h)?.profileDir;
}

export type { Ref, WorkspaceHandle, WorkspacePort };
