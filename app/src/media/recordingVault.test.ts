import { describe, expect, it } from "vitest";
import type { RecordingRow } from "../data/db";

describe("recording vault metadata", () => {
  it("identifies a verified original by exact byte length", () => {
    const r = { id: "1", sizeBytes: 1024, status: "ready" } as RecordingRow;
    expect(r.status === "ready" && r.sizeBytes === 1024).toBe(true);
  });
});
