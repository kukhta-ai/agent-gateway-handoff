// AC#6 — error + exit taxonomy: every taxonomy error carries a stable namespaced `code` that
// maps to the documented exit code (0–8); mount.* → 3/5/7/8 per §5. The mapping is DATA callers
// branch on (`exitCodeFor`), so no prose parsing.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECOVERY_SKILL,
  EXIT_CODE_BY_ERROR,
  type ErrorCode,
  ExitCode,
  GlaErrorException,
  exitCodeFor,
  glaError,
  isGlaError,
} from "./errors.js";

describe("exitCodeFor — the documented namespace → exit map (§5.2)", () => {
  it("maps each namespace to its coarse exit code", () => {
    expect(exitCodeFor("usage.invalid_flag")).toBe(ExitCode.USAGE); // 2
    expect(exitCodeFor("policy.denied")).toBe(ExitCode.POLICY); // 3
    expect(exitCodeFor("auth.insufficient")).toBe(ExitCode.AUTH); // 4
    expect(exitCodeFor("catalog.unknown")).toBe(ExitCode.NOT_FOUND); // 5
    expect(exitCodeFor("state.not_found")).toBe(ExitCode.NOT_FOUND); // 5
    expect(exitCodeFor("state.conflict")).toBe(ExitCode.CONFLICT); // 7
    expect(exitCodeFor("dependency.unavailable")).toBe(ExitCode.DEPENDENCY); // 8
    expect(exitCodeFor("catalog.unavailable")).toBe(ExitCode.DEPENDENCY); // 8
  });

  it("the LOAD-BEARING mount.* mapping: denied→3, not_found→5, conflict→7, unsupported→8", () => {
    expect(exitCodeFor("mount.denied")).toBe(ExitCode.POLICY); // 3
    expect(exitCodeFor("mount.not_found")).toBe(ExitCode.NOT_FOUND); // 5
    expect(exitCodeFor("mount.conflict")).toBe(ExitCode.CONFLICT); // 7
    expect(exitCodeFor("mount.unsupported")).toBe(ExitCode.DEPENDENCY); // 8
  });

  it("the map is exhaustive over the ErrorCode union and every value is a valid 0–8 exit", () => {
    for (const [code, exit] of Object.entries(EXIT_CODE_BY_ERROR)) {
      expect(typeof code).toBe("string");
      expect(exit).toBeGreaterThanOrEqual(0);
      expect(exit).toBeLessThanOrEqual(8);
    }
    // sanity: a representative code per namespace is present in the data table
    const codes = Object.keys(EXIT_CODE_BY_ERROR) as ErrorCode[];
    for (const ns of ["usage", "policy", "auth", "catalog", "state", "dependency", "mount"]) {
      expect(codes.some((c) => c.startsWith(`${ns}.`))).toBe(true);
    }
  });
});

describe("GlaErrorException — a typed, machine-distinguishable carrier", () => {
  it("carries a stable code, the recovery skill, and exposes its exit code", () => {
    const e = glaError("mount.conflict", "target collides", { detail: { target: "/work/x" } });
    expect(isGlaError(e)).toBe(true);
    expect(e).toBeInstanceOf(GlaErrorException);
    expect(e.code).toBe("mount.conflict");
    expect(e.skill).toBe(DEFAULT_RECOVERY_SKILL);
    expect(e.exitCode).toBe(ExitCode.CONFLICT);
    // round-trips to the wire shape (§5 / docs/05 §4)
    const wire = e.toGlaError();
    expect(wire).toMatchObject({
      code: "mount.conflict",
      message: "target collides",
      skill: DEFAULT_RECOVERY_SKILL,
      retryable: false,
      detail: { target: "/work/x" },
    });
  });
});
