import { describe, expect, it } from "vitest";
import { classifyRecoveredBytes } from "./recoveryScan";

describe("safe inspection of original recordings", () => {
  it("marks exact byte copies but does not claim they were decoded", () => {
    expect(classifyRecoveredBytes(92_000_000, 92_000_000)).toBe("complete");
  });
  it("warns when a stopped copy left only part of the original", () => {
    expect(classifyRecoveredBytes(25_000_000, 92_000_000)).toBe("partial");
  });
  it("keeps unregistered OPFS files discoverable instead of deleting them", () => {
    expect(classifyRecoveredBytes(80_000_000, null)).toBe("unknown");
  });
});
