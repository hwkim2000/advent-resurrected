// Voice_Layer shell (spec: voice-input, Requirements 1.4, 1.5, 2.7, 2.11, 2.12,
// 3.8, 5.9, 7.12, 8.10, 8.11, 9.10, 19.2, 19.3; design 3.9). New code for this
// project; not ported from Open Adventure.
//
// The pure reducer (session-machine.ts) decides; this shell executes. It owns
// a run-to-completion event queue, one scheduler handle per timer id, the
// provider (built lazily through an injected factory) and the subscribers.
// DOM-free: the provider, scheduler, environment and host are all injected.
// It never calls getUserMedia, never starts a session during initialization
// and imports no adapter module. src/voice imports nothing from src/ui, so the
// host and port types are declared structurally (they match
// src/ui/voice-port.ts).

import { MAGIC_PHRASES } from './config';
import { detectEnvironment, type DetectEnv, type PermissionStatusLike } from './detect';
import type { HostSnapshot } from './final-result';
import {
  availabilityOf,
  initialState,
  isListening,
  reduce,
  viewOf,
  type Fatal,
  type GestureEvent,
  type Mode,
  type TimerId,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceState,
  type VoiceView,
} from './session-machine';
import type { ProviderCallbacks, SpeechProvider, VoiceErrorCode } from './speech-provider';

/** Structurally the VoiceLayerHost of src/ui/voice-port.ts. */
export interface ControllerHost {
  submit(line: string, origin: 'typed' | 'spoken'): void;
  readonly promptKind: HostSnapshot['promptKind'];
  readonly phase: HostSnapshot['phase'];
  readonly gameMode: HostSnapshot['gameMode'];
  readonly log: { error(message: string, cause?: unknown): void };
}

/** Injected timers and clock; method names match tests/voice/support/fake-scheduler.ts. */
export interface Scheduler {
  now(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number | undefined): void;
}

export interface VoiceLayerDeps {
  readonly host: ControllerHost;
  /** Builds the provider with the callbacks the shell routes into the machine. */
  readonly createProvider: (callbacks: ProviderCallbacks) => SpeechProvider;
  readonly scheduler: Scheduler;
  readonly env: DetectEnv;
  /** Defaults to host.log. Only ever receives 'voice: <code>'. */
  readonly log?: { error(message: string, cause?: unknown): void };
}

/** Structurally the VoicePort of src/ui/voice-port.ts. */
export interface ControllerPort {
  getView(): VoiceView;
  onView(listener: (view: VoiceView) => void): () => void;
  dispatch(event: GestureEvent): { readonly preventDefault: boolean };
}

/** Structurally the VoiceLayer of src/ui/voice-port.ts. */
export interface ControllerLayer {
  readonly port: ControllerPort;
  readonly usable: boolean;
  readonly listening: boolean;
  subscribe(listener: (listening: boolean) => void): () => void;
  gameStart(mode: Mode): void;
  syncHost(): void;
}

function sameView(a: VoiceView, b: VoiceView): boolean {
  return (
    a.availability === b.availability &&
    a.pressed === b.pressed &&
    a.disabled === b.disabled &&
    a.status === b.status &&
    (a.announcement?.seq ?? -1) === (b.announcement?.seq ?? -1)
  );
}

function notifyAll<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch {
      // A throwing listener must not stop the others (Requirement 19.3).
    }
  }
}

export function createVoiceLayer(deps: VoiceLayerDeps): ControllerLayer {
  const { host, scheduler, env } = deps;
  const logger = deps.log ?? host.log;

  let state: VoiceState = initialState();
  const queue: VoiceEvent[] = [];
  let running = false;
  let provider: SpeechProvider | undefined;
  const timers = new Map<TimerId, number>();
  const viewListeners = new Set<(view: VoiceView) => void>();
  const listeningListeners = new Set<(listening: boolean) => void>();
  let lastView: VoiceView = viewOf(state);
  let lastListening = isListening(state);
  let detectionDone = false;
  let permissionStatus: PermissionStatusLike | undefined;

  // Read at the moment an event is processed (Requirement 9.10).
  function readHost(): HostSnapshot {
    return { gameMode: host.gameMode, promptKind: host.promptKind, phase: host.phase };
  }
  function hostKey(h: HostSnapshot): string {
    return `${String(h.phase)}|${String(h.promptKind)}|${String(h.gameMode)}`;
  }
  let lastHostKey = hostKey(readHost());

  function logCode(code: VoiceErrorCode): void {
    try {
      logger.error('voice: ' + code);
    } catch {
      // Logging must never break the layer.
    }
  }

  function clearTimerId(id: TimerId): void {
    const handle = timers.get(id);
    if (handle !== undefined) {
      scheduler.clearTimer(handle);
      timers.delete(id);
    }
  }

  function setTimerId(id: TimerId, ms: number): void {
    clearTimerId(id);
    // Tag with the session id and the status sequence at set time.
    const sid = state.session?.sid ?? 0;
    const seq = state.status.seq;
    const handle = scheduler.setTimer(() => {
      if (timers.get(id) === handle) timers.delete(id);
      dispatch({ type: 'timer', id, sid, seq });
    }, ms);
    timers.set(id, handle);
  }

  function ensureProvider(): SpeechProvider {
    if (provider === undefined) {
      const callbacks: ProviderCallbacks = {
        onStart: () => dispatch({ type: 'p-start' }),
        onInterim: (text) => dispatch({ type: 'p-interim', text }),
        onFinal: (alternatives) => dispatch({ type: 'p-final', alternatives }),
        onError: (code) => dispatch({ type: 'p-error', code }),
        onEnd: () => dispatch({ type: 'p-end' }),
      };
      provider = deps.createProvider(callbacks);
    }
    return provider;
  }

  function execute(effect: VoiceEffect): void {
    switch (effect.kind) {
      case 'provider-start':
        try {
          ensureProvider().start({ ...effect.options, phrases: effect.options.phrases ?? MAGIC_PHRASES });
        } catch {
          queue.push({ type: 'start-threw' });
        }
        return;
      case 'provider-stop':
        try {
          provider?.stop();
        } catch {
          // stop never throws by contract; ignore defensively.
        }
        return;
      case 'provider-abort':
        try {
          provider?.abort();
        } catch {
          // abort never throws by contract; ignore defensively.
        }
        return;
      case 'timer-set':
        setTimerId(effect.id, effect.ms);
        return;
      case 'timer-clear':
        clearTimerId(effect.id);
        return;
      case 'submit':
        // Synchronous loop so a Magic_Match is atomic (Requirement 8.10).
        for (const line of effect.lines) {
          try {
            host.submit(line, 'spoken');
          } catch {
            logCode('other');
          }
        }
        return;
      case 'log':
        logCode(effect.code);
        return;
    }
  }

  function publish(): void {
    const view = viewOf(state);
    if (!sameView(view, lastView)) {
      lastView = view;
      notifyAll(viewListeners, view);
    }
    const listening = isListening(state);
    if (listening !== lastListening) {
      lastListening = listening;
      notifyAll(listeningListeners, listening);
    }
  }

  function process(event: VoiceEvent): void {
    const ctx = { now: scheduler.now(), host: readHost() };
    let result;
    try {
      result = reduce(state, event, ctx);
    } catch {
      logCode('other');
      return;
    }
    state = result.state;
    for (const effect of result.effects) execute(effect);
    publish();
  }

  function dispatch(event: VoiceEvent): void {
    queue.push(event);
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) process(next);
      }
    } finally {
      running = false;
    }
  }

  function permissionEvent(value: unknown): void {
    if (value === 'denied' || value === 'granted' || value === 'prompt') {
      dispatch({ type: 'permission', state: value });
    }
  }

  // Requirements 2.6, 2.11: after Ready, inside try/catch, failures ignored.
  function queryPermission(): void {
    try {
      const query = env.queryMicrophone;
      if (query === undefined) return;
      const pending = query.call(env);
      pending.then(
        (status) => {
          try {
            permissionStatus = status;
            permissionEvent(status.state);
            status.onchange = () => permissionEvent(permissionStatus?.state);
          } catch {
            // Ignored.
          }
        },
        () => {
          // Rejection is ignored.
        },
      );
    } catch {
      // A synchronous throw is ignored.
    }
  }

  const port: ControllerPort = {
    getView: () => viewOf(state),
    onView(listener) {
      viewListeners.add(listener);
      return () => {
        viewListeners.delete(listener);
      };
    },
    dispatch(event) {
      const availability = availabilityOf(state);
      const wasPressed = state.session !== null;
      dispatch(event);
      let preventDefault = false;
      if (event.type === 'altm-down') preventDefault = availability === 'Ready' || availability === 'Busy';
      else if (event.type === 'escape') preventDefault = wasPressed;
      return { preventDefault };
    },
  };

  return {
    port,
    get usable(): boolean {
      const a = availabilityOf(state);
      return a === 'Ready' || a === 'Busy';
    },
    get listening(): boolean {
      return isListening(state);
    },
    subscribe(listener) {
      listeningListeners.add(listener);
      return () => {
        listeningListeners.delete(listener);
      };
    },
    gameStart(mode) {
      let startedDetection = false;
      if (mode === 'haunted' && !detectionDone) {
        detectionDone = true;
        let fatal: Fatal = null;
        try {
          fatal = detectEnvironment(env).fatal ?? null;
        } catch {
          fatal = 'runtime';
        }
        dispatch({ type: 'detected', fatal });
        startedDetection = fatal === null;
      }
      dispatch({ type: 'game-start', mode });
      lastHostKey = hostKey(readHost());
      if (startedDetection) queryPermission();
    },
    syncHost() {
      const key = hostKey(readHost());
      if (key === lastHostKey) return;
      lastHostKey = key;
      dispatch({ type: 'host-changed' });
    },
  };
}
