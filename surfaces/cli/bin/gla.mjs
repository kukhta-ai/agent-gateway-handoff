#!/usr/bin/env node
// `gla` binary entry point.
// Thin launcher: load the compiled CLI surface and run it against the real process, exiting with
// the dispatcher's documented exit code (docs/05 §5). Build first (`pnpm build`) — this imports the
// emitted dist/. Kept as plain ESM so the published `bin` and `node surfaces/cli/bin/gla.mjs` both work.
import { main } from "../dist/index.js";

process.exitCode = main(process.argv.slice(2));
