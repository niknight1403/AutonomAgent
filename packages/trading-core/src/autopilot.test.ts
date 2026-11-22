import { describe, expect, it } from "vitest";
import { runLocalDemo } from "./autopilot.js";

describe("explicit local product demo", () => {
  it("uses only labeled examples and keeps all actions in review", () => {
    const first = runLocalDemo();
    expect(first).toEqual(runLocalDemo());
    expect(first).toHaveLength(3);
    expect(first.every((item) => item.candidate.source === "LOCAL_DEMO")).toBe(true);
    expect(first.some((item) => item.approval === "REJECTED" && item.rejectionReasons.length > 0)).toBe(true);
    expect(first.some((item) => item.approval === "PENDING_APPROVAL" && item.listingDrafts.length > 0)).toBe(true);
    expect(first.every((item) => item.listingDrafts.every((draft) => draft.status === "DRAFT_ONLY"))).toBe(true);
  });
});
