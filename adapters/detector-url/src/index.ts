// @gla/detector-url — adapter ring (baseline §1, docs/03 §9, GLA-042/043).
// CompletionDetector: url-watcher (+ user-done). Implements the kernel `CompletionDetectorPort`:
//   - contract: the typed `config_schema` the detector accepts (`complete_on`, optional `intermediate`).
//   - watch(runtime, params): an AsyncIterable that WATCHES the capsule browser's current URL (over the
//     capsule's CDP — it reads `http://127.0.0.1:<cdpPort>/json` and observes the active page target's
//     `url`, polling on a short interval) and EMITS a RawCompletionSignal whenever the URL first MATCHES
//     a declared `complete_on` (e.g. `/dashboard`) or an `intermediate` (e.g. `/verify`).
//
// The capsule only EMITS the raw signal; it does NOT decide completion (GLA-043 AC#2). The Completion
// service (packages/completion) validates each emitted signal against THIS detector's `contract` and
// normalizes the valid ones to a CompletionEnvelope (an out-of-contract signal is REJECTED there — S-8).
// A new detector TYPE (exit-code / dom-watcher / user-done) plugs in via this SAME seam with NO capsule
// change (GLA-043 AC#4): each is a separate `adapters/detector-*` package behind the same port, wired at
// `app`; the capsule/session/completion core names none of them.
//
// Boundary (adapter ring): depends ONLY on @gla/kernel (the CompletionDetectorPort + types + the neutral
// runtime-handle codec it reads the CDP endpoint off) + Node builtins (the global `fetch` for the CDP
// `/json` read). It does NOT import the launcher or connector adapter (the boundary lint forbids
// adapter→adapter): it reads the CDP base off the kernel's neutral `decodeRuntimeHandle`. Injected at
// `app`; core never imports it.

import {
  type ConfigSchema,
  type Iso8601,
  type RawCompletionSignal,
  type RuntimeHandle,
  decodeRuntimeHandle,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const DETECTOR_URL_MODULE = "@gla/detector-url" as const;
/** Ring classification from the architecture baseline (informational). */
export const DETECTOR_URL_RING = "adapter" as const;

/** The stable detector name carried on every signal this adapter emits (`detector` field). */
export const DETECTOR_URL_NAME = "url-watcher" as const;

/**
 * The stable `status` the url-watcher emits on a match. The Completion service maps the matched URL to a
 * caller-facing envelope `status` (e.g. `submitted` / `verified`) via the detector's declared contract; the
 * raw signal carries one of these two mechanical statuses so the contract can branch on intermediate vs
 * complete (scenario-01: `/verify` → an intermediate "submitted, next email-verification"; `/dashboard` →
 * the complete "verified").
 */
export type UrlWatcherStatus = "url-intermediate" | "url-complete";

/**
 * The url-watcher's declared contract (kernel `ConfigSchema`) — the typed params the agent may set on the
 * `{use:"url-watcher", params:{…}}` detector part (docs/05 assembly `detectors`). The Completion service
 * validates each emitted raw signal AGAINST this contract (S-8). Both URL fields are simple strings the
 * watcher does a substring/prefix match on (the reference flow's success is the navigation to a path).
 *
 *   - `complete_on`  (required): the URL fragment whose first match emits a `url-complete` signal (e.g. `/dashboard`).
 *   - `intermediate` (optional): a URL fragment whose first match emits a `url-intermediate` signal (e.g. `/verify`).
 */
export const URL_WATCHER_CONTRACT: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["complete_on"],
  properties: {
    complete_on: { type: "string", minLength: 1 },
    intermediate: { type: "string", minLength: 1 },
  },
};

/** Options for {@link DetectorUrlAdapter}. */
export interface DetectorUrlOptions {
  /** Poll interval (ms) for the CDP `/json` URL read. Default 200ms (deterministic + cheap on loopback). */
  pollMs?: number;
  /**
   * A custom URL reader (tests inject a scripted sequence; default reads the capsule's CDP `/json`). Given the
   * runtime handle, returns the active page target's current URL, or undefined if none/unreachable.
   */
  readUrl?: (handle: RuntimeHandle) => Promise<string | undefined>;
  /** A clock seam (tests pin it); defaults to the wall clock. */
  now?: () => Iso8601;
}

/**
 * The url-watcher CompletionDetector adapter (docs/03 §9). Implements `CompletionDetectorPort`: it declares
 * its `contract` (the typed params) and `watch`es the capsule's live URL over CDP, EMITTING a raw signal on
 * the first match of an `intermediate` then the `complete_on` URL. It only emits; the Completion service
 * decides (validates vs the contract + normalizes). The capsule needs no change for a different detector
 * type — that is a different adapter behind this same port (GLA-043 AC#4).
 */
export class DetectorUrlAdapter {
  /** The typed params this detector accepts — the Completion service validates raw signals against it. */
  readonly contract: ConfigSchema = URL_WATCHER_CONTRACT;

  private readonly pollMs: number;
  private readonly readUrl: (handle: RuntimeHandle) => Promise<string | undefined>;
  private readonly now: () => Iso8601;

  constructor(opts: DetectorUrlOptions = {}) {
    this.pollMs = opts.pollMs ?? 200;
    this.readUrl = opts.readUrl ?? ((h) => readActiveTargetUrl(h, this.pollMs));
    this.now = opts.now ?? (() => new Date().toISOString() as Iso8601);
  }

  /**
   * Watch the capsule's current URL and emit a {@link RawCompletionSignal} on a TRANSITION into the declared
   * `intermediate` (status `url-intermediate`) then the `complete_on` (status `url-complete`) URL fragment (kernel
   * `CompletionDetectorPort.watch`). It polls the active page target's URL over the capsule's CDP on `pollMs`.
   *
   * **The intermediate is EDGE-triggered; the complete is level-triggered.** The intermediate fires only on a
   * TRANSITION *into* it — the previous poll's URL did NOT match the intermediate and this one does — so a window
   * whose page is ALREADY at the intermediate when the watch begins does **not** re-fire it. This is what makes the
   * SECOND handoff correct (scenario-01 Phase 12/13): window 2 RE-OPENS while the capsule still shows `/verify` (the
   * intermediate window 1 already completed on); without edge-triggering, window 2 would instantly re-complete on the
   * stale `/verify` instead of waiting for the human to reach `/dashboard`. The first poll establishes the BASELINE
   * URL (no intermediate fire on it). The `complete_on` match is the terminal navigation and fires on ANY match
   * (level — a page that reaches it completes regardless of where it started), after which the iterator COMPLETES.
   * Each fragment still fires AT MOST ONCE. A consumer that stops iterating (a closed window) abandons it cleanly.
   *
   * The `result` carries the matched `url` + `match` (the fragment matched) — detector-shaped data the
   * Completion service validates + normalizes. It does NOT decide completion: it reports the mechanical
   * fact "the live page reached this URL" (GLA-043 AC#2).
   *
   * @param handle  the live capsule runtime (its CDP endpoint is read off this handle)
   * @param params  the agent-declared params (validated against {@link contract}); `complete_on` required
   */
  async *watch(
    handle: RuntimeHandle,
    params: Record<string, unknown>,
  ): AsyncIterable<RawCompletionSignal> {
    const completeOn = typeof params.complete_on === "string" ? params.complete_on : undefined;
    const intermediate = typeof params.intermediate === "string" ? params.intermediate : undefined;
    if (completeOn === undefined || completeOn.length === 0) {
      // No target to watch — a misconfigured detector emits nothing (the window then TTL-expires, GLA-043
      // AC#3). The Completion service / admission validate the params up front; this is the fail-closed floor.
      return;
    }
    let firedIntermediate = false;
    // The previous poll's URL — `undefined` only before the FIRST observation, so the first observed URL is the
    // BASELINE (the intermediate is never fired on it; only a later TRANSITION into the intermediate fires).
    let prevUrl: string | undefined;
    // Poll the live URL; the intermediate emits on a TRANSITION into it, the complete on any match (terminal).
    for (;;) {
      const url = await this.readUrl(handle);
      if (url !== undefined) {
        const transitionedIntoIntermediate =
          intermediate !== undefined &&
          !firedIntermediate &&
          url.includes(intermediate) &&
          !url.includes(completeOn) &&
          // EDGE: the previous observation did NOT match the intermediate (a fresh navigation INTO it). On the
          // first poll `prevUrl` is undefined ⇒ the baseline is suppressed (a window that opens already at the
          // intermediate does not re-fire it — the second-handoff correctness, scenario-01 Phase 12/13).
          prevUrl !== undefined &&
          !prevUrl.includes(intermediate);
        if (transitionedIntoIntermediate) {
          firedIntermediate = true;
          yield this.signal("url-intermediate", url, intermediate);
        }
        if (url.includes(completeOn)) {
          yield this.signal("url-complete", url, completeOn);
          return; // the terminal navigation — the watch is done.
        }
        prevUrl = url;
      }
      await delay(this.pollMs);
    }
  }

  /** Build a raw signal carrying the mechanical status + the matched url/fragment (detector-shaped result). */
  private signal(status: UrlWatcherStatus, url: string, match: string): RawCompletionSignal {
    return {
      status,
      result: { url, match },
      detector: DETECTOR_URL_NAME,
      at: this.now(),
    };
  }
}

/**
 * Read the capsule's ACTIVE page-target URL over CDP: GET `http://127.0.0.1:<cdpPort>/json`, pick the first
 * `type:"page"` target, return its `url`. Returns undefined if the handle carries no CDP endpoint or the
 * endpoint is unreachable (so the watcher fails closed — no URL ⇒ no signal). Uses only the global `fetch`
 * and the kernel's neutral runtime-handle codec (no adapter→adapter import).
 */
async function readActiveTargetUrl(
  handle: RuntimeHandle,
  timeoutMs: number,
): Promise<string | undefined> {
  const d = decodeRuntimeHandle(handle);
  const cdpPort = typeof d?.cdpPort === "number" ? d.cdpPort : undefined;
  if (cdpPort === undefined) {
    return undefined;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(timeoutMs, 1000));
    if (typeof t.unref === "function") {
      t.unref();
    }
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      return undefined;
    }
    const targets = (await res.json()) as Array<{ type?: string; url?: string }>;
    const page = targets.find((tt) => tt.type === "page" && typeof tt.url === "string");
    return typeof page?.url === "string" ? page.url : undefined;
  } catch {
    // The CDP endpoint is not (yet) answering / the browser is gone — no URL to report.
    return undefined;
  }
}

/** A small async delay (the poll interval). Unref'd timer so it never keeps the process alive on its own. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof (t as { unref?: () => void }).unref === "function") {
      (t as { unref: () => void }).unref();
    }
  });
}

export type { ConfigSchema, RawCompletionSignal, RuntimeHandle };
