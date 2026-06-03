// surfaces/cli · output helper (docs/05 §1, §4).
// Contract:
//   - stdout = RESULTS. JSON by default; human-readable text only when stdout is a TTY
//     (or when `-o text` is forced). `-o json` forces JSON even at a TTY.
//   - stderr = DIAGNOSTICS / ERRORS, as a JSON `{error:{...}}` object (docs/05 §4).
// The separation is absolute so an agent can capture stdout and parse it blind.

/** Output mode requested via -o/--output. `auto` = JSON unless stdout is a TTY. */
export type OutputMode = "json" | "text" | "auto";

/** Stable error shape (docs/05 §4): the agent branches on `code`; `skill` is its recovery pointer. */
export interface CliError {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
  /** The skill the agent should load to reason about recovery (cognition stays in the skill). */
  skill?: string;
  retryable?: boolean;
}

/** Minimal streams seam so tests can drive the helper without touching the real process. */
export interface OutputStreams {
  stdout: { write(s: string): void; isTTY?: boolean };
  stderr: { write(s: string): void; isTTY?: boolean };
}

function defaultStreams(): OutputStreams {
  return {
    stdout: { write: (s) => void process.stdout.write(s), isTTY: process.stdout.isTTY },
    stderr: { write: (s) => void process.stderr.write(s), isTTY: process.stderr.isTTY },
  };
}

/** Resolve the effective mode: `auto` becomes `text` only when stdout is a TTY, else `json`. */
export function resolveMode(mode: OutputMode, isTty: boolean): "json" | "text" {
  if (mode === "json") return "json";
  if (mode === "text") return "text";
  return isTty ? "text" : "json";
}

export class Output {
  private readonly streams: OutputStreams;
  private readonly mode: OutputMode;

  constructor(mode: OutputMode = "auto", streams: OutputStreams = defaultStreams()) {
    this.mode = mode;
    this.streams = streams;
  }

  private effective(): "json" | "text" {
    return resolveMode(this.mode, this.streams.stdout.isTTY === true);
  }

  /** Emit a successful RESULT to stdout. */
  emit(data: unknown, text?: (data: unknown) => string): void {
    if (this.effective() === "text") {
      const rendered = text ? text(data) : renderText(data);
      this.streams.stdout.write(`${rendered}\n`);
    } else {
      this.streams.stdout.write(`${JSON.stringify(data)}\n`);
    }
  }

  /** Emit an ERROR to stderr. Always a JSON `{error:{...}}` object (machine-parseable on stderr). */
  fail(error: CliError): void {
    if (this.effective() === "text") {
      const skill = error.skill ? ` (skill: ${error.skill})` : "";
      this.streams.stderr.write(`error[${error.code}]: ${error.message}${skill}\n`);
    } else {
      this.streams.stderr.write(`${JSON.stringify({ error })}\n`);
    }
  }
}

/** Naive text rendering of a result object: one `key: value` line per own field. */
function renderText(data: unknown): string {
  if (data === null || typeof data !== "object") return String(data);
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}
