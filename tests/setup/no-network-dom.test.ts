// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

describe("no-network guard (happy-dom environment)", () => {
  it("makes global fetch throw", () => {
    expect(() => fetch("https://example.com/")).toThrow(
      "real network request attempted in test",
    );
  });

  it("makes window.fetch throw too", () => {
    expect(() => window.fetch("https://example.com/")).toThrow(
      "real network request attempted in test",
    );
  });
});
