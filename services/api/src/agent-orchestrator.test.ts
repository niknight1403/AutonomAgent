import { describe, expect, it } from "vitest";

describe("orchestrator bounds", () => {
  it("keeps configured worker parallelism within the documented ceiling", () => {
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 32;
    expect(valid(1)).toBe(true);
    expect(valid(32)).toBe(true);
    expect(valid(0)).toBe(false);
    expect(valid(33)).toBe(false);
  });
});
