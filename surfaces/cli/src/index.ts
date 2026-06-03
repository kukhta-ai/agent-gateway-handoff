// @gla/cli — EDGE ring (baseline §1). The `gla` command tree over the bridge core (docs/05).
// Public surface of the package: the pure `run()` dispatcher, the `Output` helper, the exit-code
// taxonomy, and a `main()` that binds them to the real process (used by bin/gla.mjs).

import { run } from "./cli.js";
import { Output, type OutputMode } from "./output.js";

export { run, CLI_VERSION } from "./cli.js";
export { Output, resolveMode } from "./output.js";
export type { OutputMode, OutputStreams, CliError } from "./output.js";
export { ExitCode } from "./exit-codes.js";

/**
 * Process entry point: parse the global output flag from argv just enough to construct the sink,
 * run the dispatcher against the real stdout/stderr, and return the exit code. The caller (the bin
 * shim) is responsible for `process.exit` so this stays side-effect-light and testable. Async
 * because the dispatcher connects to the Agent Bridge (minting the agent-authority anchor).
 */
export function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const mode = sniffOutputMode(argv);
  const out = new Output(mode);
  return run(argv, out);
}

/** Pre-scan argv for -o/--output so the Output sink is built with the right mode up front. */
function sniffOutputMode(argv: readonly string[]): OutputMode {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o" || argv[i] === "--output") {
      const v = argv[i + 1];
      if (v === "json" || v === "text") return v;
    }
  }
  return "auto";
}
