// Browser entry of the lazily loaded voice chunk (spec: voice-input, Requirements
// 1.3, 3.8; design 3.9). New code for this project; not ported from Open Adventure.
//
// Composes the real environment (isSecureContext, navigator.permissions,
// performance.now, setTimeout) with the Web Speech adapter and the session
// controller. This is the dynamic-import target of src/main.ts. It imports
// nothing from src/ui: the host and layer types are structural (voice-loader.ts
// checks them against src/ui/voice-port.ts). Nothing here starts a session, asks
// for the microphone or touches the network when the layer is created.

import type { DetectEnv, PermissionStatusLike } from './detect';
import { createVoiceLayer, type ControllerHost, type ControllerLayer, type Scheduler } from './session-controller';
import type { VoiceErrorCode } from './speech-provider';
import { createWebSpeechProvider } from './web-speech-adapter';

/** The real clock and timers. Handles are numbers in the browser. */
function createRealScheduler(): Scheduler {
  return {
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (id) => {
      if (id !== undefined) clearTimeout(id);
    },
  };
}

/** Creates the Voice_Layer on the real window and navigator. */
export function createBrowserVoiceLayer(host: ControllerHost): ControllerLayer {
  const win = globalThis;
  // Detection helper only: its callbacks are never called (it never starts).
  const detector = createWebSpeechProvider(
    {
      onStart: () => undefined,
      onInterim: () => undefined,
      onFinal: () => undefined,
      onError: () => undefined,
      onEnd: () => undefined,
    },
    win,
  );

  const env: DetectEnv = {
    isSecureContext: win.isSecureContext === true,
    hasRecognition: () => detector.hasRecognition(),
    probe: () => detector.probe(),
    queryMicrophone: () => {
      const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions;
      if (permissions === undefined || typeof permissions.query !== 'function') {
        return Promise.reject(new Error('no permissions API'));
      }
      return permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => status as unknown as PermissionStatusLike);
    },
    log: (code: VoiceErrorCode) => {
      try {
        host.log.error('voice: ' + code);
      } catch {
        // Logging must never break the layer.
      }
    },
  };

  return createVoiceLayer({
    host,
    scheduler: createRealScheduler(),
    env,
    createProvider: (callbacks) => createWebSpeechProvider(callbacks, win),
  });
}
