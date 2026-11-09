import { describe, expect, it } from "vitest";

describe("no-network guard (node environment)", () => {
  it("makes global fetch throw", () => {
    expect(() => fetch("https://example.com/")).toThrow(
      "real network request attempted in test",
    );
  });
});
