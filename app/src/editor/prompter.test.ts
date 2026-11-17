import { describe, expect, it } from "vitest";
import { pictureTurn, poseOf } from "./prompter";

describe("poseOf", () => {
  it("reads upright and both sides, spec and WebKit signs", () => {
    expect(poseOf(0.3, 9.6, 1)).toBe("portrait");
    expect(poseOf(0.3, -9.6, -1)).toBe("portrait");
    expect(poseOf(9.6, 0.5, 1)).toBe("left");
    expect(poseOf(-9.6, 0.5, 1)).toBe("right");
    expect(poseOf(-9.6, 0.5, -1)).toBe("left");
    expect(poseOf(9.6, 0.5, -1)).toBe("right");
  });
  it("keeps the last pose when flat or in between", () => {
    expect(poseOf(0.2, 0.1, 1)).toBeNull();
    expect(poseOf(6.5, 6.5, 1)).toBeNull();
  });
});

describe("pictureTurn", () => {
  it("turns tall pictures back up when horizontal, opposite for the front camera", () => {
    expect(pictureTurn(true, false, "left", "environment")).toBe(270);
    expect(pictureTurn(true, false, "right", "environment")).toBe(90);
    expect(pictureTurn(true, false, "left", "user")).toBe(90);
    expect(pictureTurn(true, false, "right", "user")).toBe(270);
  });
  it("leaves vertical and already wide pictures", () => {
    expect(pictureTurn(false, false, "left", "user")).toBe(0);
    expect(pictureTurn(true, true, "right", "environment")).toBe(0);
  });
});
