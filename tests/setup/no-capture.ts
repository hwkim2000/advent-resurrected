// Test guard: no test may capture audio or open a real network channel other
// than fetch (guarded by no-network.ts). Registered via `setupFiles` in
// vitest.config.ts. Tests that need these APIs must inject fakes explicitly.
//
// Constructor stubs are plain functions (arrow functions cannot be `new`ed and
// would fail with "is not a constructor" instead of the guard message).
// `AudioContext` itself is never replaced.

export const NO_CAPTURE_MESSAGE = "real capture or network channel attempted in test";

function blocked(): never {
  throw new Error(NO_CAPTURE_MESSAGE);
}

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

const g = globalThis as Record<string, unknown>;

define(g, "MediaRecorder", function MediaRecorder(): never {
  return blocked();
});
define(g, "XMLHttpRequest", function XMLHttpRequest(): never {
  return blocked();
});
define(g, "WebSocket", function WebSocket(): never {
  return blocked();
});
define(g, "EventSource", function EventSource(): never {
  return blocked();
});

const nav = (g.navigator ?? {}) as Record<string, unknown>;
if (g.navigator === undefined) define(g, "navigator", nav);

define(nav, "sendBeacon", function sendBeacon(): never {
  return blocked();
});

if (nav.mediaDevices === undefined || nav.mediaDevices === null) {
  define(nav, "mediaDevices", {});
}
define(nav.mediaDevices as object, "getUserMedia", function getUserMedia(): never {
  return blocked();
});

const audioContext = g.AudioContext as { prototype?: object } | undefined;
const audioProto = audioContext?.prototype;
if (audioProto !== undefined) {
  define(audioProto, "createMediaStreamSource", function createMediaStreamSource(): never {
    return blocked();
  });
}
