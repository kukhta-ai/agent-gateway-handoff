#!/usr/bin/env node
import { main as cliMain } from "@gla/cli";
// `gla` binary — the FULL command, including `serve`.
// Thin launcher over the COMPOSITION ROOT (packages/app): `serve` boots the long-running daemon (the :3000
// deployable) here, because only `app` may import the adapters the daemon wires; every OTHER command delegates
// to the edge `@gla/cli` dispatcher (which, when GLA_ENDPOINT is set, forwards over the bridge socket to a
// running daemon — docs/05 §"Connection & auth"). Build first (`pnpm build`) — this imports the emitted dist/.
import { runServe } from "../dist/index.js";

const argv = process.argv.slice(2);
if (argv[0] === "serve") {
  // The long-running daemon: bind the public gateway + the local bridge, stay alive, graceful shutdown.
  process.exitCode = await runServe(argv.slice(1));
} else {
  // Every other command: the `gla` control surface (in-process, or forwarded to the daemon when GLA_ENDPOINT set).
  process.exitCode = await cliMain(argv);
}
