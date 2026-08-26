// @gla/channel-cli — adapter ring (baseline §1).
// The FALLBACK ChannelAdapter (docs/03 §2, components/channel-adapter.md): the real local/CLI
// channel used headlessly (and in the scenario-01 E2E harness in place of Telegram). It implements
// the kernel `ChannelPort` (kernel-contracts.md §6):
//   - receive() yields inbound `{ recipient, message, chatContext }` from an injectable source —
//     an in-memory queue (so a test can inject one), a file, or stdin.
//   - deliver(recipient, link) writes the link to stdout or a file (the E2E "human" polls it).
// It attaches the recipient binding by calling an injected `IdentityPort` (a KERNEL interface, not a
// concrete identity package) — so the adapter stays ring-clean (imports kernel ports + node builtins
// only) and a second channel (telegram) is added behind the SAME port with no core change.
//
// Boundary: this is an adapter; it depends ONLY on `@gla/kernel` port types + node builtins. The
// composition root (`app`) injects the IdentityPort implementation and chooses the inbound source.

import { appendFileSync, readFileSync } from "node:fs";
import type {
  ChannelPort,
  IdentityPort,
  OpaqueToken,
  RecipientBinding,
  RecipientRef,
} from "@gla/kernel";

/** Stable identifier for this module (used by the `app` composition root's wiring record). */
export const CHANNEL_CLI_MODULE = "@gla/channel-cli" as const;
/** Ring classification from the architecture baseline (informational). */
export const CHANNEL_CLI_RING = "adapter" as const;

/** One inbound item as the channel receives it (before binding). */
export interface InboundMessage {
  recipientRef: RecipientRef;
  text: string;
  /** Channel-shaped context (a CLI chat id, a Telegram chat object, …) — opaque to the core. */
  chatContext?: unknown;
}

/** An inbound item delivered to the agent WITH its recipient binding attached (GLA-015 AC#1). */
export interface BoundInbound {
  recipientRef: RecipientRef;
  text: string;
  chatContext: unknown;
  /** The recipient this message is bound to (from IdentityPort.bind). */
  binding: RecipientBinding;
}

/**
 * The source `receive()` pulls inbound messages from. The default is an in-memory queue a test (or
 * the harness) pushes to; `fromFile` reads newline-delimited JSON messages; `fromStdin` reads them
 * from a provided string. All three are the SAME port — only the source differs, which is the point
 * (a second channel swaps the source/transport, not the seam).
 */
export interface InboundSource {
  next(): Promise<InboundMessage | undefined>;
}

/**
 * An in-memory inbound queue — push messages, `receive()` drains them in order until empty (the
 * Slice-1 contract: inject messages, then drain). A test or the harness pushes inbound items; the
 * stream ends when the queue is exhausted.
 */
export class InMemoryInbound implements InboundSource {
  private readonly queue: InboundMessage[] = [];

  /** Inject an inbound message (a test or the harness calls this). */
  push(msg: InboundMessage): void {
    this.queue.push(msg);
  }

  /** Explicit end-of-stream signal; a no-op for the drain-to-empty model (kept for symmetry). */
  close(): void {
    // The drain-to-empty contract needs no flag: an empty queue is end-of-stream.
  }

  /** Return the next queued message, or `undefined` when the queue is empty (end of stream). */
  async next(): Promise<InboundMessage | undefined> {
    return this.queue.shift();
  }
}

/** Read inbound messages from newline-delimited JSON in a file (one `InboundMessage` per line). */
export function inboundFromFile(path: string): InboundSource {
  let lines: string[] | undefined;
  let i = 0;
  return {
    async next(): Promise<InboundMessage | undefined> {
      if (lines === undefined) {
        const raw = (() => {
          try {
            return readFileSync(path, "utf8");
          } catch {
            return "";
          }
        })();
        lines = raw.split("\n").filter((l) => l.trim().length > 0);
      }
      const line = lines[i++];
      if (line === undefined) {
        return undefined;
      }
      return JSON.parse(line) as InboundMessage;
    },
  };
}

/** Read inbound messages from a string (e.g. stdin contents): newline-delimited JSON. */
export function inboundFromStdin(contents: string): InboundSource {
  const lines = contents.split("\n").filter((l) => l.trim().length > 0);
  let i = 0;
  return {
    async next(): Promise<InboundMessage | undefined> {
      const line = lines[i++];
      return line === undefined ? undefined : (JSON.parse(line) as InboundMessage);
    },
  };
}

/** Where `deliver()` writes the link: a sink the E2E "human" polls. Defaults to stdout. */
export interface DeliverySink {
  write(line: string): void;
}

/** A delivery sink that appends each link line to a file (the harness polls the file). */
export function deliveryToFile(path: string): DeliverySink {
  return { write: (line) => appendFileSync(path, `${line}\n`, "utf8") };
}

/** A delivery sink that writes each link to stdout. */
export const deliveryToStdout: DeliverySink = {
  write: (line) => void process.stdout.write(`${line}\n`),
};

/** Construction options for the CLI channel adapter. */
export interface ChannelCliOptions {
  /** The identity port used to attach the recipient binding to each inbound message. */
  identity: IdentityPort;
  /** The inbound source (defaults to a fresh in-memory queue). */
  source?: InboundSource;
  /** The delivery sink for outbound links (defaults to stdout). */
  sink?: DeliverySink;
}

/**
 * The CLI channel adapter (a {@link ChannelPort}). `deliver` writes the recipient-bound handoff
 * link to the sink; `receive` yields inbound messages from the source. `receiveBound` is the
 * adapter's richer surface used by the Bridge: it attaches the recipient binding (via the injected
 * IdentityPort) so the agent gets the message AND the recipient it is bound to — the inbound
 * contract of GLA-015 AC#1, with no task/session state touched (AC#3).
 */
export class ChannelCli implements ChannelPort {
  private readonly identity: IdentityPort;
  private readonly source: InboundSource;
  private readonly sink: DeliverySink;

  constructor(opts: ChannelCliOptions) {
    this.identity = opts.identity;
    this.source = opts.source ?? new InMemoryInbound();
    this.sink = opts.sink ?? deliveryToStdout;
  }

  /**
   * Deliver a recipient-bound link via the channel (kernel ChannelPort.deliver). Slice 1 writes the
   * link to the sink; the `delegation` token would be verified (channel-delegation) by a richer
   * channel before sending — recorded but not enforced here (the adapter never widens the binding).
   * Outbound link delivery changes no task/session state.
   */
  async deliver(recipient: RecipientRef, link: string, _delegation: OpaqueToken): Promise<void> {
    // The line is JSON so the polling "human" can parse the recipient + link unambiguously.
    this.sink.write(JSON.stringify({ recipient, link }));
  }

  /**
   * Yield inbound messages as the kernel ChannelPort requires: `{ recipient, message, chatContext }`.
   * Pulls from the injected source until it is exhausted (returns undefined). Pure w.r.t. task/
   * session state — receiving writes nothing to those aggregates (GLA-015 AC#3).
   */
  async *receive(): AsyncIterable<{
    recipient: RecipientRef;
    message: string;
    chatContext: unknown;
  }> {
    for (let msg = await this.source.next(); msg !== undefined; msg = await this.source.next()) {
      yield {
        recipient: msg.recipientRef,
        message: msg.text,
        chatContext: msg.chatContext ?? null,
      };
    }
  }

  /**
   * The Bridge-facing inbound surface: same stream as {@link receive} but with the recipient
   * binding attached (GLA-015 AC#1). The binding is obtained from the injected IdentityPort — the
   * adapter does not invent identity, it asks identity to bind the channel ref (narrow-only).
   */
  async *receiveBound(): AsyncIterable<BoundInbound> {
    for (let msg = await this.source.next(); msg !== undefined; msg = await this.source.next()) {
      const binding = await this.identity.bind(msg.recipientRef, {
        channel: channelOf(msg.recipientRef),
      });
      yield {
        recipientRef: msg.recipientRef,
        text: msg.text,
        chatContext: msg.chatContext ?? null,
        binding,
      };
    }
  }
}

/** Parse the channel prefix out of a `<channel>:user:<id>` recipient ref (for binding provenance). */
function channelOf(recipient: RecipientRef): string {
  const [channel] = recipient.split(":");
  return channel && channel.length > 0 ? channel : "cli";
}
