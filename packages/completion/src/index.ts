// @gla/completion — core ring (baseline §1, components/completion-service.md, GLA-042/043).
// The Completion service: turns a capsule's raw done-signal into a trustworthy, NORMALIZED completion.
// It validates each raw signal against the DECLARED detector contract and normalizes the valid ones to a
// stable `CompletionEnvelope` {status, result, next?}; an OUT-OF-CONTRACT signal is REJECTED (not
// normalized — a spoofed/malformed "done" cannot advance the flow; S-8 / GLA-043). It does NOT judge
// SEMANTIC success ("did registration really work" is the agent's cognition over the connector); it
// confirms a MECHANICAL signal matches its contract and maps it to the caller-facing envelope.
//
// What it owns (completion-service.md):
//   - validate(rawSignal, contract)  — check the signal's shape vs the detector's declared `config_schema`
//     contract (reuse the kernel `validateConfig`) AND that the signal's status is one the contract admits;
//     out-of-contract → REJECT (a typed `state.conflict`, the signal cannot advance the flow).
//   - normalize(rawSignal, contract) — map a VALID signal to a `CompletionEnvelope` (stable `status` across
//     detectors, the detector-shaped `result`, an optional `next` hint for a multi-step chain).
// It does NOT itself close routes or revoke grants — it INFORMS the Session service, which orchestrates the
// close (session-service.md). It does NOT decide completion semantics beyond contract validation.
//
// Boundary (core ring): depends ONLY on @gla/kernel (the CompletionEnvelope + RawCompletionSignal + the
// config_schema validator + the taxonomy). It names no detector adapter; the detector's contract is passed
// IN (a `DetectorContract`), so a new detector type validates through the SAME path with no completion-code
// change (GLA-043 AC#4). `app` wires which detector's contract a session declared.

import {
  type ConfigSchema,
  type ConfigValidation,
  type GlaError,
  type Iso8601,
  type RawCompletionSignal,
  glaError,
  validateConfig,
} from "@gla/kernel";
import type { CompletionEnvelope } from "@gla/kernel";

/** Stable package-identity marker (used by the `app` composition root's wiring record). */
export const COMPLETION_MODULE = "@gla/completion" as const;
/** Ring classification from the architecture baseline (informational). */
export const COMPLETION_RING = "core" as const;

/**
 * One status the detector contract ADMITS, with how to NORMALIZE it to the caller-facing envelope. The
 * trusted detector/template author declares this map once (the same allowlist-by-construction discipline as
 * `config_schema`): which raw mechanical statuses are valid for THIS detector, and the stable envelope
 * `status` (+ optional `next` hint) each maps to. A raw signal whose `status` is NOT a key here is
 * out-of-contract → REJECTED (S-8).
 */
export interface CompletionStatusRule {
  /** The stable envelope status this raw status normalizes to (e.g. `submitted` / `verified`). */
  status: string;
  /** An optional multi-step hint carried onto the envelope (e.g. `email-verification`). */
  next?: string;
}

/**
 * The DECLARED contract for one detector (what the session's assembly said it would accept) — the checkpoint
 * the Completion service validates each raw signal against (completion-service.md). It carries:
 *   - `detector`  — the detector name the contract is for (the raw signal's `detector` must match it);
 *   - `params`    — the typed `config_schema` the detector's `result` shape is validated against (reuse the
 *                   kernel `validateConfig`): the detector's own `contract` (kernel `CompletionDetectorPort.contract`);
 *   - `statuses`  — the admitted raw statuses → their normalization (an out-of-contract status is rejected).
 *   - `resultSchema` (optional) — a `config_schema` the raw signal's `result` object must conform to (so a
 *     malformed/oversized result is rejected, not normalized). When omitted, the result is passed through
 *     verbatim (the reference url-watcher carries a simple `{url, match}`).
 */
export interface DetectorContract {
  /** The detector this contract is for — the raw signal's `detector` must equal this (else out-of-contract). */
  detector: string;
  /** The admitted raw statuses → their envelope normalization. A status not present here is REJECTED. */
  statuses: Record<string, CompletionStatusRule>;
  /** Optional `config_schema` the raw signal's `result` must conform to (else REJECTED). */
  resultSchema?: ConfigSchema;
}

/**
 * The result of {@link CompletionService.validate}: either the signal is in-contract (ok) or it is rejected
 * with a typed {@link GlaError} (a `state.conflict` — an out-of-contract signal cannot advance the flow). A
 * test branches on `.ok`; the session never advances to `completed` on a rejection.
 */
export type CompletionValidation = { ok: true } | { ok: false; error: GlaError };

/**
 * The Completion service (component: completion-service.md). It is the checkpoint between a capsule's raw
 * done-signal and a trustworthy completion: VALIDATE the signal vs the declared detector contract, then
 * NORMALIZE the valid ones to a stable {@link CompletionEnvelope}. An out-of-contract signal is REJECTED
 * (S-8). It makes no semantic judgement and orchestrates no close (it informs the Session service).
 *
 * Stateless + pure given its inputs — no I/O, no clock except the `at` stamp the raw signal already carries
 * (so it is unit-provable). Construct once; call `validate` / `normalize` / `process` per raw signal.
 */
export class CompletionService {
  /**
   * Validate a raw completion signal against a declared detector contract (S-8 / GLA-043). Checks, in order:
   *   1. the signal's `detector` MATCHES the contract's detector (a signal from a different detector is
   *      out-of-contract);
   *   2. the signal's `status` is one the contract ADMITS (`contract.statuses` has the key) — a spoofed /
   *      unknown status is rejected;
   *   3. (when `contract.resultSchema` is declared) the signal's `result` CONFORMS to it (reusing the kernel
   *      `validateConfig` — the same offline validator admission uses) — a malformed result is rejected.
   * On any failure it returns `{ ok:false, error }` with a typed `state.conflict` (the signal cannot legally
   * advance the flow); on success `{ ok:true }`. NEVER throws — the caller branches on `.ok`.
   *
   * @param signal    the raw, not-yet-trusted signal the capsule emitted
   * @param contract  the contract the session declared this detector would accept
   */
  validate(signal: RawCompletionSignal, contract: DetectorContract): CompletionValidation {
    // 1) The signal must come from the declared detector (a different detector is out-of-contract).
    if (signal.detector !== contract.detector) {
      return {
        ok: false,
        error: this.rejected(
          `signal from detector "${signal.detector}" does not match the declared detector "${contract.detector}"`,
          { detector: signal.detector, expected: contract.detector },
        ),
      };
    }
    // 2) The status must be one the contract admits (allowlist-by-construction — a spoofed status is rejected).
    if (!Object.hasOwn(contract.statuses, signal.status)) {
      return {
        ok: false,
        error: this.rejected(
          `completion signal "${signal.status}" is not in the detector contract`,
          { status: signal.status, admitted: Object.keys(contract.statuses) },
        ),
      };
    }
    // 3) When a result schema is declared, the result must conform (a malformed result is rejected).
    if (contract.resultSchema !== undefined) {
      const result = signal.result ?? {};
      const validation: ConfigValidation = validateConfig(contract.resultSchema, result);
      if (!validation.ok) {
        const first = validation.defects[0];
        return {
          ok: false,
          error: this.rejected(
            `completion signal result is out-of-contract: ${first?.message ?? "shape mismatch"}`,
            { defects: validation.defects },
          ),
        };
      }
    }
    return { ok: true };
  }

  /**
   * Normalize a VALID raw signal to a stable {@link CompletionEnvelope} (completion-service.md): map the raw
   * status to the contract's caller-facing envelope `status`, carry the detector-shaped `result` and the
   * detector name, copy the optional `next` hint from the matched status rule, and stamp `at` from the
   * signal. The envelope shape is STABLE across detectors (kernel-contracts.md §1.6 invariant). Call this
   * ONLY on a signal {@link validate} accepted; a defensive re-check rejects an out-of-contract status by
   * throwing (so a mis-sequenced caller cannot normalize a spoofed signal).
   *
   * @throws GlaErrorException (`state.conflict`) if the signal's status is not admitted by the contract.
   */
  normalize(signal: RawCompletionSignal, contract: DetectorContract): CompletionEnvelope {
    const rule = contract.statuses[signal.status];
    if (rule === undefined) {
      // Defensive: never normalize an out-of-contract signal (the validate gate should have caught it).
      throw glaError(
        "state.conflict",
        `cannot normalize out-of-contract signal "${signal.status}"`,
        { detail: { status: signal.status } },
      );
    }
    const envelope: CompletionEnvelope = {
      status: rule.status,
      detector: signal.detector,
      at: signal.at,
    };
    if (signal.result !== undefined) {
      envelope.result = signal.result;
    }
    if (rule.next !== undefined) {
      envelope.next = rule.next;
    }
    return envelope;
  }

  /**
   * Validate + normalize in one call (the common path the Session service uses): if the signal is in-contract,
   * return `{ ok:true, envelope }`; otherwise `{ ok:false, error }` (the window does NOT complete — S-8). This
   * is the single entry point that guarantees an out-of-contract signal NEVER yields an envelope.
   *
   * @param signal    the raw signal the capsule emitted
   * @param contract  the declared detector contract
   */
  process(
    signal: RawCompletionSignal,
    contract: DetectorContract,
  ): { ok: true; envelope: CompletionEnvelope } | { ok: false; error: GlaError } {
    const validation = this.validate(signal, contract);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    return { ok: true, envelope: this.normalize(signal, contract) };
  }

  /** Build the typed out-of-contract rejection (a `state.conflict` — the signal cannot advance the flow). */
  private rejected(message: string, detail: Record<string, unknown>): GlaError {
    return {
      code: "state.conflict",
      message,
      detail,
      skill: "interpret-gla-rejections",
      retryable: false,
    };
  }
}

export type { CompletionEnvelope, RawCompletionSignal, Iso8601 };
