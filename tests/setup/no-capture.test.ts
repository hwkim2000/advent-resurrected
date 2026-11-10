import { describe, expect, it } from "vitest";
import { NO_CAPTURE_MESSAGE } from "./no-capture";

describe("no-capture guard (node environment)", () => {
  it("blocks getUserMedia", () => {
    expect(() => navigator.mediaDevices.getUserMedia({ audio: true })).toThrow(NO_CAPTURE_MESSAGE);
  });

  it.each(["MediaRecorder", "XMLHttpRequest", "WebSocket", "EventSource"])(
    "blocks constructing %s",
    (name) => {
      const Ctor = (globalThis as Record<string, unknown>)[name] as new () => unknown;
      expect(() => new Ctor()).toThrow(NO_CAPTURE_MESSAGE);
    },
  );

  it("blocks sendBeacon", () => {
    expect(() => navigator.sendBeacon("https://example.com/", "x")).toThrow(NO_CAPTURE_MESSAGE);
  });

  it("leaves AudioContext untouched and guards createMediaStreamSource when present", () => {
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
