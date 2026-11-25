import { describe, expect, it } from "vitest";
import { advanceStablePose, displayPose, initialStablePose, oppositeSide, pictureTurn, poseOf } from "./prompter";

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

describe("displayPose without motion permission", () => {
  it("uses the browser orientation without asking for motion sensors", () => {
    expect(displayPose(0, 390, 844)).toBe("portrait");
    expect(displayPose(90, 390, 844)).toBe("right");
    expect(displayPose(-90, 390, 844)).toBe("left");
    expect(displayPose(270, 390, 844)).toBe("left");
    expect(displayPose(null, 844, 390)).toBe("right");
    expect(displayPose(null, 390, 844)).toBe("portrait");
  });
});

describe("stable rotation on the iPhone", () => {
  it("waits for sustained landscape gravity before changing the UI", () => {
    let state = initialStablePose();
    state = advanceStablePose(state, "left", 100);
    expect(state.confirmed).toBeNull();
    state = advanceStablePose(state, "right", 250); // accidental shake
    state = advanceStablePose(state, "left", 300);
    state = advanceStablePose(state, "left", 699);
    expect(state.confirmed).toBeNull();
    state = advanceStablePose(state, "left", 701);
    expect(state.confirmed).toBe("left");
  });

  it("does not flip when the phone is flat or motion is ambiguous", () => {
    let state = initialStablePose();
    state = advanceStablePose(state, "left", 0);
    state = advanceStablePose(state, "left", 450);
    state = advanceStablePose(state, null, 500);
    state = advanceStablePose(state, "right", 550);
    state = advanceStablePose(state, null, 580);
    state = advanceStablePose(state, "right", 630);
    expect(state.confirmed).toBe("left");
    state = advanceStablePose(state, "right", 1031);
    expect(state.confirmed).toBe("right");
  });

  it("allows one deliberate manual correction of an inverted horizontal view", () => {
    expect(oppositeSide("left")).toBe("right");
    expect(oppositeSide(oppositeSide("left"))).toBe("left");
    expect(pictureTurn(true, false, oppositeSide("left"), "environment")).toBe(90);
  });

  it("interprets sideways gravity consistently with a fixed iPhone sign", () => {
    expect(poseOf(9.6, 0.2, -1)).toBe("right");
    expect(poseOf(-9.6, -0.2, -1)).toBe("left");
    // Reversing the y axis (upside-down portrait) never changes the sign
    // used for landscape calibration.
    expect(poseOf(-9.6, 0.2, -1)).toBe(poseOf(-9.6, -0.2, -1));
  });
});
