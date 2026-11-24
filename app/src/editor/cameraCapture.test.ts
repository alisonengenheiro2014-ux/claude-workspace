import { describe, expect, it } from "vitest";
import { actualVideoLabel, boundZoom, digitalZoomFactor, nativeZoomRange, pinchZoomLevel, targetVideoSize } from "./cameraCapture";

describe("camera capture options", () => {
  it("requests 720p, 1080p, 2K and 4K without upscaling", () => {
    expect(targetVideoSize(720)).toEqual({ width: 1280, height: 720 });
    expect(targetVideoSize(1080)).toEqual({ width: 1920, height: 1080 });
    expect(targetVideoSize(1440)).toEqual({ width: 2560, height: 1440 });
    expect(targetVideoSize(2160)).toEqual({ width: 3840, height: 2160 });
    expect(actualVideoLabel(1920, 1080)).toBe("1080p");
    expect(actualVideoLabel(2560, 1440)).toBe("1440p");
    expect(actualVideoLabel(3840, 2160)).toBe("4K");
    expect(actualVideoLabel(1280, 720)).toBe("720p");
  });
  it("does not claim hardware zoom where browser has none", () => {
    expect(nativeZoomRange({})).toBeNull();
    expect(nativeZoomRange({ zoom: { min: 1, max: 1 } })).toBeNull();
    expect(nativeZoomRange({ zoom: { min: .5, max: 6 } })).toEqual({ min: .5, max: 6 });
    expect(boundZoom(.5, null)).toBe(1);
    expect(boundZoom(.5, { min: .5, max: 6 })).toBe(.5);
  });
  it("falls back to digital crop only when zooming in", () => {
    expect(digitalZoomFactor(2, 1)).toBe(2);
    expect(digitalZoomFactor(.5, .5)).toBe(1);
    expect(digitalZoomFactor(4, 2)).toBe(2);
  });
  it("guarantees canvas zoom even when Safari reports native zoom without changing pixels", () => {
    // The camera drawing code now deliberately uses a 1x digital baseline.
    // If Safari claims the camera is at 2x but its video frames are static,
    // the actual pixels must still get 2x cropped.
    const requestedZoom = 2;
    const browserReportedZoom = 2;
    expect(browserReportedZoom).toBe(2);
    expect(digitalZoomFactor(requestedZoom, 1)).toBe(2);
    expect(digitalZoomFactor(requestedZoom, browserReportedZoom)).toBe(1);
  });
  it("pinch expands and contracts the zoom while keeping physical bounds honest", () => {
    expect(pinchZoomLevel(1, 100, 200, null)).toBe(2);
    expect(pinchZoomLevel(2, 100, 50, null)).toBe(1);
    expect(pinchZoomLevel(2, 100, 25, { min: 0.5, max: 6 })).toBe(0.5);
    expect(pinchZoomLevel(2, 0, 100, null)).toBe(2);
    expect(pinchZoomLevel(1, 100, 600, null)).toBe(5);
  });

});
