import { describe, expect, it } from "vitest";

describe("app-local E2E test layout", () => {
  it("is discovered outside packages/app/src", () => {
    const appTestLayout = "test/e2e" as const;

    expect(appTestLayout).toBe("test/e2e");
  });
});
