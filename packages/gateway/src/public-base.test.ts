import type { OpaqueToken } from "@gla/kernel";
import { describe, expect, it } from "vitest";
import { enrollPageHtml } from "./enroll-page.js";
import { handoffPageHtml, handoffReusedPageHtml } from "./handoff-page.js";
import {
  AccessGateway,
  internalPathForPublicRequest,
  parsePublicBaseUrl,
  publicPath,
  publicUrl,
} from "./index.js";

describe("public base URL builder", () => {
  it("keeps root deployments on legacy route shapes", () => {
    const base = parsePublicBaseUrl("https://gla.example");
    expect(base).toEqual({
      href: "https://gla.example/",
      origin: "https://gla.example",
      pathPrefix: "",
    });
    expect(publicPath(base, "/enroll")).toBe("/enroll");
    expect(publicUrl(base, "/handoff/sess_1", { grant: "g" })).toBe(
      "https://gla.example/handoff/sess_1?grant=g",
    );
    expect(AccessGateway.enrollLink("https://gla.example/", "g" as OpaqueToken)).toBe(
      "https://gla.example/enroll?grant=g",
    );
  });

  it("preserves non-root base paths without dropping or double-prefixing them", () => {
    const base = parsePublicBaseUrl("https://gla.example/team-a/");
    expect(base.pathPrefix).toBe("/team-a");
    expect(publicPath(base, "/enroll")).toBe("/team-a/enroll");
    expect(publicPath(base, "/handoff/sess_1")).toBe("/team-a/handoff/sess_1");
    expect(AccessGateway.enrollLink(base.href, "g" as OpaqueToken)).toBe(
      "https://gla.example/team-a/enroll?grant=g",
    );
    expect(AccessGateway.handoffLink(base.href, "/handoff/sess_1", "g" as OpaqueToken)).toBe(
      "https://gla.example/team-a/handoff/sess_1?grant=g",
    );
  });

  it("rejects missing, malformed, query, fragment, and ambiguous path values", () => {
    for (const raw of [
      "gla.example/a",
      "/a",
      "https:///a",
      "http:///a",
      "https://user:pass@gla.example/a",
      "https://gla.example/a?x=1",
      "https://gla.example/a#frag",
      "https://gla.example/a/../b",
      "https://gla.example/a//b",
      "https://gla.example/a/%2F/b",
      "ftp://gla.example/a",
    ]) {
      expect(() => parsePublicBaseUrl(raw), raw).toThrow(/GLA_PUBLIC_BASE_URL|gateway route/i);
    }
  });

  it("does not echo a potentially grant-bearing public base value in validation errors", () => {
    const grantBearing = "https://gla.example/a?grant=secret-token";
    expect(() => parsePublicBaseUrl(grantBearing)).toThrow(/query strings are not supported/);
    expect(() => parsePublicBaseUrl(grantBearing)).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining("secret-token"),
      }),
    );
  });

  it("maps inbound prefixed and strip-prefix proxy paths to internal gateway routes", () => {
    const root = parsePublicBaseUrl("https://gla.example/");
    expect(internalPathForPublicRequest(root, "/enroll")).toBe("/enroll");

    const sub = parsePublicBaseUrl("https://gla.example/gla/");
    expect(internalPathForPublicRequest(sub, "/gla/enroll")).toBe("/enroll");
    expect(internalPathForPublicRequest(sub, "/gla/handoff/sess")).toBe("/handoff/sess");
    expect(internalPathForPublicRequest(sub, "/enroll")).toBeUndefined();
    expect(internalPathForPublicRequest(sub, "/enroll", "/gla")).toBeUndefined();
    expect(internalPathForPublicRequest(sub, "/enroll", "/gla", true)).toBe("/enroll");
  });
});

describe("public base paths in served page data", () => {
  it("enrollment page uses injected same-origin paths", () => {
    const html = enrollPageHtml("g", "recipient", {
      options: "/gla/enroll/options",
      verify: "/gla/enroll/verify",
    });
    expect(html).toContain('"options":"/gla/enroll/options"');
    expect(html).toContain('"verify":"/gla/enroll/verify"');
    expect(html).toContain("fetch(cfg.paths.options");
    expect(html).toContain("fetch(cfg.paths.verify");
  });

  it("handoff pages keep internal route scope separate from public stream paths", () => {
    const html = handoffPageHtml("g", "/handoff/sess_1", "recipient", {
      authOptions: "/gla/handoff/auth/options",
      authVerify: "/gla/handoff/auth/verify",
      stream: "/gla/handoff/sess_1",
    });
    expect(html).toContain('"path":"/handoff/sess_1"');
    expect(html).toContain('"streamPath":"/gla/handoff/sess_1"');
    expect(html).toContain('"authOptions":"/gla/handoff/auth/options"');
    expect(html).toContain('"authVerify":"/gla/handoff/auth/verify"');
    expect(html).toContain("fetch(cfg.paths.authOptions");
    expect(html).toContain("fetch(cfg.paths.authVerify");

    const reused = handoffReusedPageHtml(
      "g",
      "/handoff/sess_1",
      "recipient",
      "/gla/handoff/sess_1",
    );
    expect(reused).toContain('"streamPath":"/gla/handoff/sess_1"');
    expect(reused).toContain("cfg.streamPath");
  });
});
