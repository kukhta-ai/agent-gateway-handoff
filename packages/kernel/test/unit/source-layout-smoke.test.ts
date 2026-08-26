import { describe, expect, it } from "vitest";
import { KERNEL_MODULE } from "../../src/index.js";

describe("package-local unit test layout", () => {
  it("is discovered and typechecked outside runtime src", () => {
    const layoutMarker: { readonly package: "@gla/kernel"; readonly layout: "test/unit" } = {
      package: KERNEL_MODULE,
      layout: "test/unit",
    };

    expect(layoutMarker).toEqual({ package: "@gla/kernel", layout: "test/unit" });
  });
});
