// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { NO_CAPTURE_MESSAGE } from "./no-capture";

describe("no-capture guard (happy-dom environment)", () => {
  it("blocks getUserMedia", () => {
    expect(() => navigator.mediaDevices.getUserMedia({ audio: true })).toThrow(NO_CAPTURE_MESSAGE);
  });

  it.each(["MediaRecorder", "XMLHttpRequest", "WebSocket", "EventSource"])(
    "blocks constructing %s",
    (name) => {
      const Ctor = (window as unknown as Record<string, unknown>)[name] as new () => unknown;
      expect(() => new Ctor()).toThrow(NO_CAPTURE_MESSAGE);
    },
  );

  it("blocks sendBeacon", () => {
    expect(() => navigator.sendBeacon("https://example.com/", "x")).toThrow(NO_CAPTURE_MESSAGE);
  });

  it("does not replace AudioContext", () => {
    const ac = (globalThis as Record<string, unknown>).AudioContext as
      | { prototype: Record<string, unknown>; name: string }
      | undefined;
    if (ac === undefined) {
      expect(ac).toBeUndefined();
      return;
    }
    expect(ac.name).toBe("AudioContext");
    expect(() => (ac.prototype.createMediaStreamSource as () => void)()).toThrow(NO_CAPTURE_MESSAGE);
  });
});
