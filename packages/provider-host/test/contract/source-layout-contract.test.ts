import { describe, expect, it } from "vitest";
import { ProviderHost } from "../../src/index.js";

describe("package-local contract test layout", () => {
  it("is discovered and typechecked outside runtime src", () => {
    const host = new ProviderHost();

    expect(host.providerIds()).toEqual([]);
  });
});
