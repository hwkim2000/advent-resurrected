// Pure Voice_Session state machine (spec: voice-input, Requirements 1.4, 1.5,
// 2.14, 4, 5, 6, 7 and 19; design "Session state machine"). New code for this
// project; not ported from Open Adventure.
//
// reduce(state, event, ctx) -> { state, effects }. No timers, DOM, clock, I/O
// or provider access: time comes from ctx.now and the host facts from
// ctx.host. The shell (session-controller.ts) executes the effects.
// src/voice imports nothing from src/ui, so the gesture and mode types are
// declared here structurally (they match src/ui/voice-port.ts).

import {
  MAX_LISTEN_MS,
  MAGIC_PHRASES,
  MIN_HOLD_MS,
  PREVIEW_MAX_CHARS,
  REPEATED_ERRORS_BEFORE_HIDE,
  RESULT_WAIT_MS,
  STATUS_CLEAR_MS,
} from './config';
import { cleanTranscript } from './clean';
import { decideFinal, type HostSnapshot } from './final-result';
import {
  HEARD_ANNOUNCE_PREFIX,
  HEARD_PREFIX,
  LISTENING,
  NO_MICROPHONE,
  NOTHING_HEARD,
  SERVICE_NOT_ANSWERING,
  VOICE_NOT_AVAILABLE,
  VOICE_TROUBLE,
} from './messages';
import type { StartOptions, VoiceErrorCode } from './speech-provider';

export type Mode = '1976' | 'haunted';
export type PointerKind = 'mouse' | 'pen' | 'touch';

export type GestureEvent =
  | { type: 'pointer-down'; pointerType: PointerKind }
  | { type: 'pointer-up'; pointerType: PointerKind }
  | { type: 'pointer-cancel'; pointerType: PointerKind }
  | { type: 'button-activate'; via: 'keyboard' | 'touch' }
  | { type: 'altm-down'; repeat: boolean }
  | { type: 'altm-up' }
  | { type: 'escape' }
  | { type: 'window-blur' }
  | { type: 'page-hidden' }
  | { type: 'pagehide' };

export type TimerId = 'maxListen' | 'resultWait' | 'startConfirm' | 'statusClear';
export type PressSource = 'pointer' | 'altm' | 'activate';
export type Fatal = null | 'unsupported' | 'permission' | 'runtime';
export type VoiceAvailabilityName = 'Unsupported' | 'Ready' | 'Busy' | 'Suspended' | 'Unavailable';

export interface Session {
  readonly sid: number;
  phase: 'starting' | 'listening' | 'finished';
  mode: 'pending' | 'hold' | 'latch';
  source: PressSource;
  /** ctx.now at the start request. */
  pressedAt: number;
  /** The pointer or Alt+M press that started the session is still down. */
  held: boolean;
  /** A stop-press is in progress: its release must do nothing. */
  swallowRelease: boolean;
  stopRequested: boolean;
  finalSeen: boolean;
  errorSeen: boolean;
}

export interface VoiceState {
  readonly detected: boolean;
  readonly fatal: Fatal;
  readonly suspended: boolean;
  /** Page-lifetime consecutive failure counter (Requirement 7.13). */
  readonly failures: number;
  readonly session: Session | null;
  readonly nextSid: number;
  readonly disabled: boolean;
  readonly status: { readonly text: string; readonly seq: number };
  /** Monotonic across the page lifetime so a DOM module can detect "new". */
  readonly announceSeq: number;
  readonly announcement: { readonly seq: number; readonly text: string } | null;
}

export type VoiceEvent =
  | GestureEvent
  | { type: 'p-start' }
  | { type: 'p-interim'; text: string }
  | { type: 'p-final'; alternatives: readonly string[] }
  | { type: 'p-error'; code: VoiceErrorCode }
  | { type: 'p-end' }
  | { type: 'start-threw' }
  | { type: 'timer'; id: TimerId; sid: number; seq: number }
  | { type: 'game-start'; mode: Mode }
  | { type: 'host-changed' }
  | { type: 'detected'; fatal: Fatal }
  | { type: 'permission'; state: 'granted' | 'denied' | 'prompt' };

export type VoiceEffect =
  | { kind: 'provider-start'; options: StartOptions }
  | { kind: 'provider-stop' }
  | { kind: 'provider-abort' }
  | { kind: 'timer-set'; id: TimerId; ms: number }
  | { kind: 'timer-clear'; id: TimerId }
  | { kind: 'submit'; lines: readonly string[] }
  | { kind: 'log'; code: VoiceErrorCode };

export interface ReduceContext {
  readonly now: number;
  readonly host: HostSnapshot;
}

export interface ReduceResult {
  readonly state: VoiceState;
  readonly effects: VoiceEffect[];
}

/** Structurally the VoiceViewState of src/ui/voice-port.ts. */
export interface VoiceView {
  readonly availability: VoiceAvailabilityName;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly status: string;
  readonly announcement: { readonly seq: number; readonly text: string } | null;
}

/** Before the first Haunted game start the layer is Suspended (design 3.9). */
export function initialState(): VoiceState {
  return {
    detected: false,
    fatal: null,
    suspended: true,
    failures: 0,
    session: null,
    nextSid: 1,
    disabled: true,
    status: { text: '', seq: 0 },
    announceSeq: 0,
    announcement: null,
  };
}

/** Derived availability; `suspended` is an independent flag (DD-8). */
export function availabilityOf(state: VoiceState): VoiceAvailabilityName {
  if (state.fatal === 'unsupported') return 'Unsupported';
  if (state.suspended) return 'Suspended';
  if (state.fatal === 'runtime' || state.fatal === 'permission') return 'Unavailable';
  if (state.session !== null) return 'Busy';
  return 'Ready';
}

/** Requirement 19.2: true from session start until it ends or is aborted. */
export function isListening(state: VoiceState): boolean {
  return state.session !== null;
}

export function viewOf(state: VoiceState): VoiceView {
  return {
    availability: availabilityOf(state),
    pressed: state.session !== null,
    disabled: state.disabled,
    status: state.status.text,
    announcement: state.announcement,
  };
}

// ---------------------------------------------------------------- helpers

const SESSION_TIMERS: readonly TimerId[] = ['maxListen', 'resultWait', 'startConfirm'];

function noop(state: VoiceState): ReduceResult {
  return { state, effects: [] };
}

/** Requirement 4.14: not ready, a filename prompt, or no running game. */
function computeDisabled(host: HostSnapshot): boolean {
  return host.phase !== 'ready' || host.promptKind === undefined || host.promptKind === 'filename';
}

function setStatus(state: VoiceState, text: string): VoiceState {
  return { ...state, status: { text, seq: state.status.seq + 1 } };
}

function announce(state: VoiceState, text: string): VoiceState {
  const seq = state.announceSeq + 1;
  return { ...state, announceSeq: seq, announcement: { seq, text } };
}

function message(state: VoiceState, text: string): VoiceState {
  return announce(setStatus(state, text), text);
}

function withSession(state: VoiceState, patch: Partial<Session>): VoiceState {
  if (state.session === null) return state;
  return { ...state, session: { ...state.session, ...patch } };
}

function timerClears(ids: readonly TimerId[]): VoiceEffect[] {
  return ids.map((id): VoiceEffect => ({ kind: 'timer-clear', id }));
}

function armStatusClear(): VoiceEffect {
  return { kind: 'timer-set', id: 'statusClear', ms: STATUS_CLEAR_MS };
}

/** Requirements 5.5, 6.11: abort, clear all timers, clear status now, no message. */
function abort(state: VoiceState): ReduceResult {
  if (state.session === null) return noop(state);
  const next = setStatus({ ...state, session: null }, '');
  return {
    state: next,
    effects: [
      { kind: 'provider-abort' },
      ...timerClears([...SESSION_TIMERS, 'statusClear']),
    ],
  };
}

/** Stop request: provider-stop, RESULT_WAIT_MS timer, no maxListen. Only once per session. */
function requestStop(state: VoiceState, extra: Partial<Session> = {}): ReduceResult {
  const s = state.session;
  if (s === null || s.stopRequested) return noop(state);
  return {
    state: withSession(state, { ...extra, stopRequested: true }),
    effects: [
      { kind: 'provider-stop' },
      { kind: 'timer-set', id: 'resultWait', ms: RESULT_WAIT_MS },
      { kind: 'timer-clear', id: 'maxListen' },
    ],
  };
}

function setRuntimeFatal(state: VoiceState): VoiceState {
  return state.fatal === 'unsupported' ? state : { ...state, fatal: 'runtime' };
}

/**
 * Apply the outcome of one error code (design error table). The caller
 * decides what happens to the session. Returns effects without log/timers
 * for the session itself; includes the statusClear arming.
 */
function applyErrorCode(state: VoiceState, code: VoiceErrorCode): ReduceResult {
  switch (code) {
    case 'aborted':
      return { state: setStatus(state, ''), effects: [] };
    case 'denied':
    case 'unsupported-language':
      return {
        state: setRuntimeFatal(message(state, VOICE_NOT_AVAILABLE)),
        effects: [armStatusClear()],
      };
    case 'no-device':
      return {
        state: setRuntimeFatal(message(state, NO_MICROPHONE)),
        effects: [armStatusClear()],
      };
    case 'no-speech':
      return {
        state: { ...message(state, NOTHING_HEARD), failures: 0 },
        effects: [armStatusClear()],
      };
    case 'network':
    case 'other': {
      const failures = state.failures + 1;
      const text = code === 'network' ? SERVICE_NOT_ANSWERING : VOICE_TROUBLE;
      let next: VoiceState = { ...message(state, text), failures };
      if (failures >= REPEATED_ERRORS_BEFORE_HIDE) next = setRuntimeFatal(next);
      return { state: next, effects: [armStatusClear()] };
    }
    default:
      // Total: an unknown code is handled as `other` (defensive; type is closed).
      return applyErrorCode(state, 'other');
  }
}

// ---------------------------------------------------------------- gestures

/**
 * A start request (mouse/pen press, keyboard or touch activation, Alt+M).
 * With a latched, running session it is a stop request instead.
 */
function activation(
  state: VoiceState,
  ctx: ReduceContext,
  source: PressSource,
  isPointerPress: boolean,
): ReduceResult {
  if (computeDisabled(ctx.host)) return noop(state);
  const s = state.session;
  if (s === null) {
    if (availabilityOf(state) !== 'Ready') return noop(state);
    const session: Session = {
      sid: state.nextSid,
      phase: 'starting',
      mode: source === 'activate' ? 'latch' : 'pending',
      source,
      pressedAt: ctx.now,
      held: source !== 'activate',
      swallowRelease: false,
      stopRequested: false,
      finalSeen: false,
      errorSeen: false,
    };
    return {
      state: { ...state, session, nextSid: state.nextSid + 1 },
      effects: [
        { kind: 'provider-start', options: { phrases: MAGIC_PHRASES } },
        { kind: 'timer-set', id: 'startConfirm', ms: MAX_LISTEN_MS + RESULT_WAIT_MS },
        { kind: 'timer-clear', id: 'statusClear' },
      ],
    };
  }
  if (s.mode === 'latch' && !s.stopRequested && s.phase !== 'finished') {
    return requestStop(state, isPointerPress ? { swallowRelease: true } : {});
  }
  return noop(state);
}

/** pointer-up / altm-up (Requirements 4.2, 4.3, 4.4, 4.8, 4.16, 5.4). */
function release(state: VoiceState, ctx: ReduceContext, source: 'pointer' | 'altm'): ReduceResult {
  const s = state.session;
  if (s === null) return noop(state);
  if (source === 'pointer' && s.swallowRelease) {
    return { state: withSession(state, { swallowRelease: false }), effects: [] };
  }
  if (s.source !== source || !s.held) return noop(state);
  if (s.phase === 'finished' || s.stopRequested || s.mode !== 'pending') {
    return { state: withSession(state, { held: false }), effects: [] };
  }
  if (ctx.now - s.pressedAt >= MIN_HOLD_MS) {
    return requestStop(state, { held: false, mode: 'hold' });
  }
  return { state: withSession(state, { held: false, mode: 'latch' }), effects: [] };
}

function gesture(state: VoiceState, event: GestureEvent, ctx: ReduceContext): ReduceResult {
  switch (event.type) {
    case 'pointer-down':
      // Touch pointer events never act (Requirements 4.17, 4.19).
      if (event.pointerType === 'touch') return noop(state);
      return activation(state, ctx, 'pointer', true);
    case 'pointer-up':
      if (event.pointerType === 'touch') return noop(state);
      return release(state, ctx, 'pointer');
    case 'pointer-cancel': {
      if (event.pointerType === 'touch') return noop(state);
      const s = state.session;
      if (s === null) return noop(state);
      if (s.swallowRelease) {
        return { state: withSession(state, { swallowRelease: false }), effects: [] };
      }
      if (s.held && s.source === 'pointer' && s.phase !== 'finished') return abort(state);
      return noop(state);
    }
    case 'button-activate':
      return activation(state, ctx, 'activate', false);
    case 'altm-down':
      if (event.repeat) return noop(state);
      return activation(state, ctx, 'altm', false);
    case 'altm-up':
      return release(state, ctx, 'altm');
    case 'escape':
    case 'window-blur':
    case 'page-hidden':
    case 'pagehide': {
      // No session: a no-op (mic-button dispatches page-hidden on every
      // visibilitychange, including to visible). A finished session is
      // closed by its end event or the end guard, keeping the result shown.
      const s = state.session;
      if (s === null || s.phase === 'finished') return noop(state);
      return abort(state);
    }
  }
}

// --------------------------------------------------------------- provider

function onFinal(state: VoiceState, alternatives: readonly string[], ctx: ReduceContext): ReduceResult {
  const s = state.session;
  if (s === null || s.phase === 'finished' || s.errorSeen || s.finalSeen) return noop(state);
  const outcome = decideFinal(alternatives, ctx.host);
  let next: VoiceState = withSession({ ...state, failures: 0 }, {
    phase: 'finished',
    finalSeen: true,
  });
  const effects: VoiceEffect[] = [
    { kind: 'timer-clear', id: 'startConfirm' },
    { kind: 'timer-clear', id: 'maxListen' },
  ];
  if (outcome.kind === 'submit') {
    effects.push({ kind: 'submit', lines: outcome.lines });
    next = announce(
      setStatus(next, HEARD_PREFIX + outcome.heard.slice(0, PREVIEW_MAX_CHARS)),
      HEARD_ANNOUNCE_PREFIX + outcome.heard,
    );
  } else if (outcome.kind === 'message') {
    next = message(next, outcome.text);
  } else {
    next = setStatus(next, '');
  }
  effects.push(armStatusClear());
  effects.push({ kind: 'timer-set', id: 'resultWait', ms: RESULT_WAIT_MS }); // end guard
  return { state: next, effects };
}

function onError(state: VoiceState, code: VoiceErrorCode): ReduceResult {
  const s = state.session;
  if (s === null || state.suspended || s.phase === 'finished' || s.errorSeen || s.finalSeen) {
    return noop(state);
  }
  const marked = withSession(state, { phase: 'finished', errorSeen: true });
  const applied = applyErrorCode(marked, code);
  const effects: VoiceEffect[] = [];
  if (code !== 'aborted') effects.push({ kind: 'log', code });
  effects.push(
    { kind: 'timer-clear', id: 'startConfirm' },
    { kind: 'timer-clear', id: 'maxListen' },
    ...applied.effects,
    { kind: 'timer-set', id: 'resultWait', ms: RESULT_WAIT_MS }, // end guard
  );
  return { state: applied.state, effects };
}

function onEnd(state: VoiceState): ReduceResult {
  const s = state.session;
  if (s === null) return noop(state);
  const effects: VoiceEffect[] = timerClears(SESSION_TIMERS);
  let next: VoiceState = { ...state, session: null };
  if (!s.finalSeen && !s.errorSeen) {
    next = { ...message(next, NOTHING_HEARD), failures: 0 };
    effects.push(armStatusClear());
  }
  return { state: next, effects };
}

function onTimer(state: VoiceState, event: Extract<VoiceEvent, { type: 'timer' }>): ReduceResult {
  const s = state.session;
  if (event.id === 'statusClear') {
    if (s !== null || event.seq !== state.status.seq || state.status.text === '') return noop(state);
    return { state: setStatus(state, ''), effects: [] };
  }
  if (s === null || s.sid !== event.sid) return noop(state);
  switch (event.id) {
    case 'maxListen':
      if (s.phase !== 'listening' || s.stopRequested) return noop(state);
      return requestStop(state);
    case 'resultWait': {
      const closed: VoiceState = { ...state, session: null };
      const effects: VoiceEffect[] = [
        { kind: 'provider-abort' },
        ...timerClears(SESSION_TIMERS),
      ];
      if (s.finalSeen || s.errorSeen) return { state: closed, effects }; // end guard
      effects.push(armStatusClear());
      return { state: message(closed, NOTHING_HEARD), effects };
    }
    case 'startConfirm': {
      if (s.phase !== 'starting') return noop(state);
      // Requirement 5.12: abort and handle as the error code `other`.
      const applied = applyErrorCode({ ...state, session: null }, 'other');
      return {
        state: applied.state,
        effects: [
          { kind: 'provider-abort' },
          ...timerClears(SESSION_TIMERS),
          { kind: 'log', code: 'other' },
          ...applied.effects,
        ],
      };
    }
  }
}

/** Requirements 5.8, 7.17, 2.14: start() threw. Failure counter unchanged. */
function onStartThrew(state: VoiceState): ReduceResult {
  const s = state.session;
  if (s === null || s.phase !== 'starting') return noop(state);
  const next = setRuntimeFatal(message({ ...state, session: null }, VOICE_NOT_AVAILABLE));
  return {
    state: next,
    effects: [
      ...timerClears(SESSION_TIMERS),
      { kind: 'log', code: 'other' },
      armStatusClear(),
    ],
  };
}

// ----------------------------------------------------------------- reducer

export function reduce(state: VoiceState, event: VoiceEvent, ctx: ReduceContext): ReduceResult {
  switch (event.type) {
    case 'pointer-down':
    case 'pointer-up':
    case 'pointer-cancel':
    case 'button-activate':
    case 'altm-down':
    case 'altm-up':
    case 'escape':
    case 'window-blur':
    case 'page-hidden':
    case 'pagehide':
      return gesture(state, event, ctx);

    case 'p-start': {
      const s = state.session;
      if (s === null || s.phase !== 'starting') return noop(state);
      const effects: VoiceEffect[] = [{ kind: 'timer-clear', id: 'startConfirm' }];
      if (!s.stopRequested) effects.push({ kind: 'timer-set', id: 'maxListen', ms: MAX_LISTEN_MS });
      return {
        state: setStatus(withSession(state, { phase: 'listening' }), LISTENING),
        effects,
      };
    }

    case 'p-interim': {
      const s = state.session;
      if (s === null || s.phase === 'finished' || s.errorSeen || s.finalSeen) return noop(state);
      const cleaned = cleanTranscript(event.text);
      if (cleaned === '') return noop(state);
      return {
        state: setStatus(state, HEARD_PREFIX + cleaned.slice(0, PREVIEW_MAX_CHARS)),
        effects: [],
      };
    }

    case 'p-final':
      return onFinal(state, event.alternatives, ctx);
    case 'p-error':
      return onError(state, event.code);
    case 'p-end':
      return onEnd(state);
    case 'start-threw':
      return onStartThrew(state);
    case 'timer':
      return onTimer(state, event);

    case 'game-start': {
      const disabled = computeDisabled(ctx.host);
      const suspended = event.mode === '1976';
      const base: VoiceState = { ...state, suspended, disabled, announcement: null };
      if (state.session !== null) {
        const aborted = abort(base);
        return aborted;
      }
      return {
        state: setStatus(base, ''),
        effects: state.status.text !== '' ? [{ kind: 'timer-clear', id: 'statusClear' }] : [],
      };
    }

    case 'host-changed': {
      const disabled = computeDisabled(ctx.host);
      const base: VoiceState = disabled === state.disabled ? state : { ...state, disabled };
      const s = base.session;
      if (s !== null && s.phase !== 'finished' && (ctx.host.phase !== 'ready' || ctx.host.promptKind === 'filename')) {
        return abort(base);
      }
      return noop(base);
    }

    case 'detected': {
      const fatal = state.fatal === null ? event.fatal : state.fatal;
      return noop({ ...state, detected: true, fatal });
    }

    case 'permission': {
      if (state.suspended) return noop(state);
      if (event.state === 'denied') {
        return state.fatal === null ? noop({ ...state, fatal: 'permission' }) : noop(state);
      }
      return state.fatal === 'permission' ? noop({ ...state, fatal: null }) : noop(state);
    }
  }
}
