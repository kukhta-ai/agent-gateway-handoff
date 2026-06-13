import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { authCallbackPageHtml } from "./callback-page.js";
import { ENROLL_REDIRECT_STORAGE_KEY } from "./enroll-page.js";

const CALLBACK_PATHS = {
  enrollVerify: "/gla/enroll/verify",
  handoffVerify: "/gla/handoff/auth/verify",
  clientAssets: "/gla/handoff/client-assets",
};

function callbackScript(html: string): string {
  const match = html.match(/<script>\n(?<script>\(\(\) => \{[\s\S]*?)\n<\/script>/);
  if (match?.groups?.script === undefined) {
    throw new Error("callback browser script not found");
  }
  return match.groups.script;
}

describe("delegated-auth callback page", () => {
  it("escapes callback page data as an inert JSON island", () => {
    const html = authCallbackPageHtml({
      enrollVerify: "/gla/enroll/verify",
      handoffVerify: "/gla/handoff/auth/verify",
      clientAssets: "/gla/handoff/client-assets</script><script>globalThis.pwned=1</script>",
    });

    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>globalThis.pwned=1</script>");
  });

  it("restores the enrollment grant from same-origin storage and posts code/state to the prefixed verify route", async () => {
    const html = authCallbackPageHtml(CALLBACK_PATHS);
    const script = callbackScript(html);
    const status = { textContent: "", className: "" };
    const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
    const removedKeys: string[] = [];

    const context = {
      URLSearchParams,
      WebSocket: vi.fn(),
      document: {
        getElementById(id: string): { textContent: string; className?: string } {
          if (id === "callback-data") {
            return { textContent: JSON.stringify({ paths: CALLBACK_PATHS }) };
          }
          if (id === "status") {
            return status;
          }
          throw new Error(`unexpected element ${id}`);
        },
      },
      encodeURIComponent,
      fetch: vi.fn(async (input: string, init: RequestInit) => {
        fetchCalls.push({ input, init });
        return { ok: true };
      }),
      history: { replaceState: vi.fn() },
      location: {
        host: "gla.example",
        pathname: "/gla/auth/callback",
        protocol: "https:",
        search: "?code=oidc-code&state=oidc-state",
      },
      sessionStorage: {
        getItem: vi.fn((key: string) =>
          key === ENROLL_REDIRECT_STORAGE_KEY ? "gla-grant-token" : null,
        ),
        removeItem: vi.fn((key: string) => {
          removedKeys.push(key);
        }),
      },
    };

    runInNewContext(script, context);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(context.history.replaceState).toHaveBeenCalledWith({}, undefined, "/gla/auth/callback");
    expect(context.sessionStorage.getItem).toHaveBeenCalledWith(ENROLL_REDIRECT_STORAGE_KEY);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.input).toBe("/gla/enroll/verify");
    expect(fetchCalls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      attestation: { code: "oidc-code", state: "oidc-state" },
    });
    expect(removedKeys).toContain(ENROLL_REDIRECT_STORAGE_KEY);
    expect(context.WebSocket).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/Enrolled/);
  });

  it("restores handoff state and posts code/state to the prefixed verify route without opening a raw stream", async () => {
    const html = authCallbackPageHtml(CALLBACK_PATHS);
    const script = callbackScript(html);
    const status = { textContent: "", className: "" };
    const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
    const removedKeys: string[] = [];
    const handoffState = {
      path: "/handoff/sess_1",
      streamPath: "/gla/handoff/sess_1",
      client: { kind: "provider-asset", ref: "fake-viewer" },
      clientAssets: "/gla/handoff/client-assets",
    };

    const context = {
      URLSearchParams,
      WebSocket: vi.fn(),
      document: {
        getElementById(id: string): { textContent: string; className?: string } {
          if (id === "callback-data") {
            return { textContent: JSON.stringify({ paths: CALLBACK_PATHS }) };
          }
          if (id === "status") {
            return status;
          }
          throw new Error(`unexpected element ${id}`);
        },
      },
      encodeURIComponent,
      fetch: vi.fn(async (input: string, init: RequestInit) => {
        fetchCalls.push({ input, init });
        return { ok: true };
      }),
      history: { replaceState: vi.fn() },
      location: {
        host: "gla.example",
        pathname: "/gla/auth/callback",
        protocol: "https:",
        search: "?code=oidc-code&state=oidc-state",
      },
      sessionStorage: {
        getItem: vi.fn((key: string) =>
          key === "gla.handoff" ? JSON.stringify(handoffState) : null,
        ),
        removeItem: vi.fn((key: string) => {
          removedKeys.push(key);
        }),
      },
    };

    runInNewContext(script, context);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.input).toBe("/gla/handoff/auth/verify");
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
      path: "/handoff/sess_1",
      assertion: { code: "oidc-code", state: "oidc-state" },
    });
    expect(removedKeys).toContain("gla.handoff");
    expect(context.WebSocket).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/no browser viewer is configured/i);
  });

  it("refuses a contextless callback without posting to verify routes or opening a stream", async () => {
    const html = authCallbackPageHtml(CALLBACK_PATHS);
    const script = callbackScript(html);
    const status = { textContent: "", className: "" };
    const context = {
      URLSearchParams,
      WebSocket: vi.fn(),
      document: {
        getElementById(id: string): { textContent: string; className?: string } {
          if (id === "callback-data") {
            return { textContent: JSON.stringify({ paths: CALLBACK_PATHS }) };
          }
          if (id === "status") {
            return status;
          }
          throw new Error(`unexpected element ${id}`);
        },
      },
      fetch: vi.fn(),
      history: { replaceState: vi.fn() },
      location: {
        host: "gla.example",
        pathname: "/gla/auth/callback",
        protocol: "https:",
        search: "?code=oidc-code&state=oidc-state",
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
      },
    };

    runInNewContext(script, context);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.WebSocket).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/No GLA session state/);
  });
});
