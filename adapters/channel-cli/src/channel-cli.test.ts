// Contract tests for the channel-cli adapter (adapters/channel-cli). The load-bearing properties:
//  - receive() attaches the recipient binding via the injected IdentityPort (GLA-015 AC#1).
//  - a second channel fits the SAME ChannelPort with no core change (proved by the port boundary).
//  - deliver() writes the link to the sink (the E2E "human" polls it).
// Uses a tiny inline IdentityPort fake so the adapter test depends only on @gla/kernel (ring-clean).
import type {
  ChannelPort,
  IdentityPort,
  OpaqueToken,
  RecipientBinding,
  RecipientRef,
} from "@gla/kernel";
import { describe, expect, it } from "vitest";
import {
  type BoundInbound,
  ChannelCli,
  type DeliverySink,
  InMemoryInbound,
  inboundFromStdin,
} from "./index.js";

/** A minimal IdentityPort: binds a channel ref to a derived user id (Slice 1 binding semantics). */
const fakeIdentity: IdentityPort = {
  async bind(recipient: RecipientRef, ctx: { channel: string }): Promise<RecipientBinding> {
    return {
      recipient,
      userId: `user:${recipient}`,
      provenance: ctx.channel,
      authStrength: "none",
    };
  },
  enroll: () => {
    throw new Error("not used");
  },
  verify: () => {
    throw new Error("not used");
  },
};

/** Drain an async iterable to an array. */
async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) {
    out.push(x);
  }
  return out;
}

describe("channel-cli receive() attaches the recipient binding (GLA-015 AC#1)", () => {
  it("yields the injected message WITH its recipient binding", async () => {
    const source = new InMemoryInbound();
    source.push({ recipientRef: "cli:user:1" as RecipientRef, text: "register me on acme" });
    source.close();
    const ch = new ChannelCli({ identity: fakeIdentity, source });

    const bound: BoundInbound[] = await drain(ch.receiveBound());
    expect(bound).toHaveLength(1);
    expect(bound[0]?.text).toBe("register me on acme");
    expect(bound[0]?.recipientRef).toBe("cli:user:1");
    // The recipient binding is attached — the agent gets the message AND who it is bound to.
    expect(bound[0]?.binding).toEqual({
      recipient: "cli:user:1",
      userId: "user:cli:user:1",
      provenance: "cli",
      authStrength: "none",
    });
  });

  it("the kernel ChannelPort.receive() yields {recipient, message, chatContext}", async () => {
    const source = new InMemoryInbound();
    source.push({
      recipientRef: "tg:user:123" as RecipientRef,
      text: "hi",
      chatContext: { chat: 7 },
    });
    source.close();
    const ch: ChannelPort = new ChannelCli({ identity: fakeIdentity, source });
    const items = await drain(ch.receive());
    expect(items[0]).toEqual({ recipient: "tg:user:123", message: "hi", chatContext: { chat: 7 } });
  });

  it("reads inbound from a stdin-style NDJSON source (injectable so a test can drive it)", async () => {
    const contents = `${JSON.stringify({ recipientRef: "cli:user:2", text: "a" })}\n${JSON.stringify({ recipientRef: "cli:user:3", text: "b" })}`;
    const ch = new ChannelCli({ identity: fakeIdentity, source: inboundFromStdin(contents) });
    const bound = await drain(ch.receiveBound());
    expect(bound.map((b) => b.text)).toEqual(["a", "b"]);
    expect(bound.map((b) => b.binding.recipient)).toEqual(["cli:user:2", "cli:user:3"]);
  });
});

describe("channel-cli deliver() writes the link to the sink (the human polls it)", () => {
  it("writes a recipient+link JSON line to the sink", async () => {
    const written: string[] = [];
    const sink: DeliverySink = { write: (l) => written.push(l) };
    const ch = new ChannelCli({ identity: fakeIdentity, sink });
    await ch.deliver(
      "cli:user:1" as RecipientRef,
      "https://gla.local/h/hand_1",
      "tok" as OpaqueToken,
    );
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] as string)).toEqual({
      recipient: "cli:user:1",
      link: "https://gla.local/h/hand_1",
    });
  });

  it("delivers a recipient-bound HANDOFF link to EXACTLY the bound recipient (GLA-033 channel delivery)", async () => {
    // The handoff link the saga built (carrying the grant) is delivered to ONLY the bound recipient — the line the
    // recipient (the E2E "human") polls carries that recipient + that link, never a different recipient.
    const written: string[] = [];
    const sink: DeliverySink = { write: (l) => written.push(l) };
    const ch = new ChannelCli({ identity: fakeIdentity, sink });
    const handoffLink = "http://gw.local/handoff/sess_abc1?grant=eyJ...";
    await ch.deliver("tg:user:123" as RecipientRef, handoffLink, "grant-tok" as OpaqueToken);
    const line = JSON.parse(written[0] as string) as { recipient: string; link: string };
    expect(line.recipient).toBe("tg:user:123");
    expect(line.link).toBe(handoffLink);
    // The adapter never widens the binding: the delivered recipient is exactly the one passed (not derived/broadened).
    expect(line.recipient).not.toBe("tg:user:999");
  });
});

describe("a second channel fits the same ChannelPort (GLA-015 AC#4)", () => {
  it("any ChannelPort implementation is interchangeable behind the port (no core change)", async () => {
    // A trivial alternate channel — proves the seam is the port, not channel-cli specifically.
    class FakeTelegram implements ChannelPort {
      delivered: Array<{ recipient: RecipientRef; link: string }> = [];
      async deliver(recipient: RecipientRef, link: string, _d: OpaqueToken): Promise<void> {
        this.delivered.push({ recipient, link });
      }
      async *receive(): AsyncIterable<{
        recipient: RecipientRef;
        message: string;
        chatContext: unknown;
      }> {
        yield {
          recipient: "tg:user:9" as RecipientRef,
          message: "from telegram",
          chatContext: null,
        };
      }
    }
    // A no-op sink so the interchangeability check writes nothing to stdout.
    const silent: DeliverySink = { write: () => {} };
    const channels: ChannelPort[] = [
      new ChannelCli({ identity: fakeIdentity, sink: silent }),
      new FakeTelegram(),
    ];
    // Both are usable through the identical port surface — the core depends on this shape only.
    for (const c of channels) {
      await c.deliver("x" as RecipientRef, "link", "t" as OpaqueToken);
      expect(typeof c.receive).toBe("function");
    }
  });
});
