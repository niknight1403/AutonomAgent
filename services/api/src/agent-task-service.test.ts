import { describe, expect, it } from "vitest";

describe("agent task lifecycle contract", () => {
  it("documents terminal and resumable states", () => {
    const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"];
    const resumable = ["QUEUED", "CHECKPOINTED"];
    expect(terminal).toHaveLength(3);
    expect(resumable).toContain("CHECKPOINTED");
  });
});
