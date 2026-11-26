import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCompletedExportInfo } from "./completedExport";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("completed export recovery metadata", () => {
  it("only offers the matching project with a safe file name and positive length", () => {
    const key = "garagem:latest-completed-export:v1";
    store.set(key, JSON.stringify({ projectId: "p1", fileName: "video-2026-11-26-06-22-333Z-abcdef00.mp4", size: 350000000, at: 2 }));
    expect(readCompletedExportInfo("p1")?.size).toBe(350000000);
    expect(readCompletedExportInfo("p2")).toBeNull();
    store.set(key, JSON.stringify({ projectId: "p1", fileName: "../private.txt", size: 1 }));
    expect(readCompletedExportInfo("p1")).toBeNull();
    store.set(key, JSON.stringify({ projectId: "p1", fileName: "video-1.mp4", size: 0 }));
    expect(readCompletedExportInfo("p1")).toBeNull();
  });
});
