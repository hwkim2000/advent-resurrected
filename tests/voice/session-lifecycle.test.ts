// Session lifecycle example tests (spec: voice-input, task 8.9).
// Drive createVoiceLayer with FakeSpeechProvider, FakeHost and FakeScheduler.
// No real time, no adapter module, no microphone.
//
// Requirements: 4.2, 4.3, 4.4, 4.5, 4.16, 4.17, 4.18, 4.19, 5.1-5.7, 5.12,
// 6.5, 8.10, 10.9, 11.4, 14.8, 18.16, 3.8, 19.2, 19.3.

import { describe, expect, it } from 'vitest';
import {
  MAX_LISTEN_MS,
  MIN_HOLD_MS,
  RESULT_WAIT_MS,
  STATUS_CLEAR_MS,
} from '../../src/voice/config';
import type { DetectEnv } from '../../src/voice/detect';
import { NOTHING_HEARD, VOICE_TROUBLE } from '../../src/voice/messages';
import { createVoiceLayer } from '../../src/voice/session-controller';
import type { VoiceView } from '../../src/voice/session-machine';
import { FakeHost } from './support/fake-host';
import { createFakeProviderFactory } from './support/fake-provider';
import { FakeScheduler } from './support/fake-scheduler';

const START_CONFIRM_MS = MAX_LISTEN_MS + RESULT_WAIT_MS;

function setup(hostInit: ConstructorParameters<typeof FakeHost>[0] = {}) {
  const host = new FakeHost(hostInit);
  const sched = new FakeScheduler();
  const fp = createFakeProviderFactory();
  const env: DetectEnv = {
    isSecureContext: true,
    hasRecognition: () => true,
    probe: () => {},
    log: () => {},
  };
  const layer = createVoiceLayer({ host, createProvider: fp.factory, scheduler: sched, env });
  layer.gameStart('haunted');
  const provider = () => {
    const p = fp.provider;
    if (p === undefined) throw new Error('provider was never built');
    return p;
  };
  return { host, sched, fp, layer, provider };
}

type Ctx = ReturnType<typeof setup>;

const down = (c: Ctx, pointerType: 'mouse' | 'pen' | 'touch' = 'mouse') =>
  c.layer.port.dispatch({ type: 'pointer-down', pointerType });
const up = (c: Ctx, pointerType: 'mouse' | 'pen' | 'touch' = 'mouse') =>
  c.layer.port.dispatch({ type: 'pointer-up', pointerType });
const tap = (c: Ctx, via: 'keyboard' | 'touch' = 'touch') =>
  c.layer.port.dispatch({ type: 'button-activate', via });
const status = (c: Ctx) => c.layer.port.getView().status;
const availability = (c: Ctx) => c.layer.port.getView().availability;

describe('session lifecycle: press gestures', () => {
  for (const pointerType of ['mouse', 'pen'] as const) {
    it(`${pointerType}: release at ${MIN_HOLD_MS - 1} ms latches (no stop)`, () => {
      const c = setup();
      down(c, pointerType);
      c.provider().emitStart();
      c.sched.advance(MIN_HOLD_MS - 1);
      up(c, pointerType);
      expect(c.provider().stopCount).toBe(0);
      expect(c.layer.listening).toBe(true);
      // The next press stops the latched session; its release does nothing more.
      down(c, pointerType);
      up(c, pointerType);
      expect(c.provider().stopCount).toBe(1);
      expect(c.provider().startCount).toBe(1);
    });

    it(`${pointerType}: release at ${MIN_HOLD_MS} ms is a hold and stops`, () => {
      const c = setup();
      down(c, pointerType);
      c.provider().emitStart();
      c.sched.advance(MIN_HOLD_MS);
      up(c, pointerType);
      expect(c.provider().stopCount).toBe(1);
      expect(c.provider().startCount).toBe(1);
    });
  }

  it('touch pointer press and release start nothing', () => {
    const c = setup();
    down(c, 'touch');
    c.sched.advance(MIN_HOLD_MS * 2);
    up(c, 'touch');
    c.layer.port.dispatch({ type: 'pointer-cancel', pointerType: 'touch' });
    expect(c.fp.provider).toBeUndefined();
    expect(c.layer.listening).toBe(false);
    expect(c.sched.pending).toBe(0);
  });

  it('touch click starts a latch session and the next click stops it, one start per tap', () => {
    const c = setup();
    tap(c, 'touch');
    expect(c.provider().startCalls).toBe(1);
    expect(c.layer.listening).toBe(true);
    c.provider().emitStart();
    tap(c, 'touch');
    expect(c.provider().stopCount).toBe(1);
    expect(c.provider().startCalls).toBe(1);
    // A third tap while the stop is pending starts nothing.
    tap(c, 'touch');
    expect(c.provider().startCalls).toBe(1);
    expect(c.provider().stopCount).toBe(1);
  });

  it('the first press starts at once: mouse, touch click, keyboard and Alt+M', () => {
    const starters: Array<(c: Ctx) => void> = [
      (c) => void down(c, 'mouse'),
      (c) => void tap(c, 'touch'),
      (c) => void tap(c, 'keyboard'),
      (c) => void c.layer.port.dispatch({ type: 'altm-down', repeat: false }),
    ];
    for (const start of starters) {
      const c = setup();
      start(c);
      expect(c.provider().startCalls).toBe(1);
      expect(c.layer.listening).toBe(true);
      expect(c.host.lines).toEqual([]);
      expect(status(c)).toBe('');
    }
  });

  it('Alt+M: short press latches, long press holds, repeats are ignored', () => {
    const c = setup();
    const d = c.layer.port.dispatch({ type: 'altm-down', repeat: false });
    expect(d.preventDefault).toBe(true);
    c.provider().emitStart();
    c.layer.port.dispatch({ type: 'altm-down', repeat: true });
    expect(c.provider().startCalls).toBe(1);
    c.sched.advance(MIN_HOLD_MS - 1);
    c.layer.port.dispatch({ type: 'altm-up' });
    expect(c.provider().stopCount).toBe(0);
    c.layer.port.dispatch({ type: 'altm-down', repeat: false });
    expect(c.provider().stopCount).toBe(1);
    c.layer.port.dispatch({ type: 'altm-up' });
    expect(c.provider().stopCount).toBe(1);

    const h = setup();
    h.layer.port.dispatch({ type: 'altm-down', repeat: false });
    h.provider().emitStart();
    h.sched.advance(MIN_HOLD_MS);
    h.layer.port.dispatch({ type: 'altm-up' });
    expect(h.provider().stopCount).toBe(1);
  });

  it('Alt+M does not prevent default when the layer is not usable', () => {
    const c = setup({ promptKind: 'filename' });
    // Ready but disabled at a filename prompt: still reported as preventable (Ready)
    // yet starts nothing.
    c.layer.port.dispatch({ type: 'altm-down', repeat: false });
    expect(c.fp.provider).toBeUndefined();
    const s = setup();
    s.layer.gameStart('1976');
    expect(s.layer.port.dispatch({ type: 'altm-down', repeat: false }).preventDefault).toBe(false);
    expect(s.fp.provider).toBeUndefined();
  });

  it('Escape is inert when idle', () => {
    const c = setup();
    const r = c.layer.port.dispatch({ type: 'escape' });
    expect(r.preventDefault).toBe(false);
    expect(c.fp.provider).toBeUndefined();
    expect(status(c)).toBe('');
  });

  it('page-hidden with no session is a no-op (no calls, no view change)', () => {
    const c = setup();
    const views: VoiceView[] = [];
    c.layer.port.onView((v) => views.push(v));
    const before = c.layer.port.getView();
    c.layer.port.dispatch({ type: 'page-hidden' });
    c.layer.port.dispatch({ type: 'pagehide' });
    c.layer.port.dispatch({ type: 'window-blur' });
    expect(views).toEqual([]);
    expect(c.layer.port.getView()).toEqual(before);
    expect(c.fp.provider).toBeUndefined();
  });

  it('page-hidden during a session aborts it silently', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.layer.port.dispatch({ type: 'page-hidden' });
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(status(c)).toBe('');
    expect(c.host.lines).toEqual([]);
  });
});

describe('session lifecycle: timers', () => {
  it('stop at MAX_LISTEN_MS: not at 9999, yes at 10000', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.sched.advance(MAX_LISTEN_MS - 1);
    expect(c.provider().stopCount).toBe(0);
    c.sched.advance(1);
    expect(c.provider().stopCount).toBe(1);
  });

  it('after stop, RESULT_WAIT_MS - 1 keeps waiting; RESULT_WAIT_MS aborts with NOTHING HEARD', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    tap(c); // stop
    expect(c.provider().stopCount).toBe(1);
    c.sched.advance(RESULT_WAIT_MS - 1);
    expect(c.provider().abortCount).toBe(0);
    expect(c.layer.listening).toBe(true);
    c.sched.advance(1);
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.lines).toEqual([]);
    expect(status(c)).toBe(NOTHING_HEARD);
  });

  it('a final delivered at RESULT_WAIT_MS - 1 after stop is submitted', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    tap(c);
    c.sched.advance(RESULT_WAIT_MS - 1);
    expect(c.provider().emitFinal(['look'])).toBe(true);
    expect(c.host.submitted).toEqual([{ line: 'look', origin: 'spoken' }]);
    expect(status(c)).toBe('HEARD: look');
    c.provider().emitEnd();
    c.sched.advance(RESULT_WAIT_MS * 2);
    expect(c.provider().abortCount).toBe(0);
    expect(availability(c)).toBe('Ready');
  });

  it('start-confirm: nothing at 12999, VOICE TROUBLE at 13000', () => {
    const c = setup();
    tap(c);
    c.sched.advance(START_CONFIRM_MS - 1);
    expect(status(c)).toBe('');
    expect(c.provider().abortCount).toBe(0);
    c.sched.advance(1);
    expect(status(c)).toBe(VOICE_TROUBLE);
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.logged.map((l) => l.message)).toEqual(['voice: other']);
  });

  it('status clears at STATUS_CLEAR_MS - 1 (still shown) and STATUS_CLEAR_MS (cleared)', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.provider().emitError('no-speech');
    c.provider().emitEnd();
    expect(status(c)).toBe(NOTHING_HEARD);
    c.sched.advance(STATUS_CLEAR_MS - 1);
    expect(status(c)).toBe(NOTHING_HEARD);
    c.sched.advance(1);
    expect(status(c)).toBe('');
  });

  it('Busy returns to Ready as soon as the end event arrives', () => {
    const c = setup();
    tap(c);
    expect(availability(c)).toBe('Busy');
    c.provider().emitStart();
    c.provider().emitFinal(['look']);
    c.provider().emitEnd();
    expect(availability(c)).toBe('Ready');
  });

  it('a result after an abort is discarded', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.layer.port.dispatch({ type: 'escape' });
    expect(c.provider().emitFinal(['look'])).toBe(false);
    c.sched.advance(START_CONFIRM_MS);
    expect(c.host.lines).toEqual([]);
    expect(status(c)).toBe('');
  });
});

describe('session lifecycle: holds and finals', () => {
  it('a final while still held is processed and the later release calls neither stop nor abort', () => {
    const c = setup();
    down(c);
    c.provider().emitStart();
    c.sched.advance(100);
    c.provider().emitFinal(['look']);
    expect(c.host.lines).toEqual(['look']);
    c.sched.advance(100);
    up(c);
    expect(c.provider().stopCount).toBe(0);
    expect(c.provider().abortCount).toBe(0);
    expect(c.provider().startCount).toBe(1);
    c.provider().emitEnd();
    expect(availability(c)).toBe('Ready');
  });
});

describe('session lifecycle: game and host changes', () => {
  it('a game start aborts a running session without a line or a message', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.layer.gameStart('haunted');
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.lines).toEqual([]);
    expect(status(c)).toBe('');
    expect(c.layer.port.getView().announcement).toBeNull();
  });

  it('a switch to Mode_1976 aborts a running session without a line or a message', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.layer.gameStart('1976');
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.lines).toEqual([]);
    expect(status(c)).toBe('');
    expect(availability(c)).toBe('Suspended');
  });

  it('a host phase change aborts the session', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.host.set({ phase: 'over' });
    c.layer.syncHost();
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.lines).toEqual([]);
  });

  it('a filename prompt aborts the session', () => {
    const c = setup();
    tap(c);
    c.provider().emitStart();
    c.host.set({ promptKind: 'filename' });
    c.layer.syncHost();
    expect(c.provider().abortCount).toBe(1);
    expect(c.layer.listening).toBe(false);
    expect(c.host.lines).toEqual([]);
  });

  it('a press at a filename prompt starts nothing', () => {
    const c = setup({ promptKind: 'filename' });
    tap(c);
    expect(c.fp.provider).toBeUndefined();
  });
});

describe('session lifecycle: magic match submission', () => {
  it('submits 1 to 4 lines in order, in one task, with one announcement', () => {
    const c = setup();
    const views: VoiceView[] = [];
    c.layer.port.onView((v) => views.push(v));
    const viewsAtSubmit: number[] = [];
    const original = c.host.submit.bind(c.host);
    c.host.submit = (line, origin) => {
      viewsAtSubmit.push(views.length);
      original(line, origin);
    };
    tap(c);
    c.provider().emitStart();
    const announcedBefore = views.filter((v) => v.announcement !== null).length;
    c.provider().emitFinal(['fee fie foe foo']);
    expect(c.host.lines).toEqual(['FEE', 'FIE', 'FOE', 'FOO']);
    expect(c.host.submitted.every((s) => s.origin === 'spoken')).toBe(true);
    // All submits happened before any view notification of the result.
    expect(new Set(viewsAtSubmit).size).toBe(1);
    const seqs = new Set(
      views.filter((v) => v.announcement !== null).map((v) => v.announcement?.seq),
    );
    expect(seqs.size - announcedBefore).toBe(1);

    const d = setup();
    tap(d);
    d.provider().emitStart();
    d.provider().emitFinal(['xyzzy']);
    expect(d.host.lines).toEqual(['XYZZY']);
  });
});

describe('session lifecycle: listening subscribe semantics', () => {
  it('does not call on subscribe; notifies true on start request and false on end', () => {
    const c = setup();
    const seen: boolean[] = [];
    c.layer.subscribe((l) => seen.push(l));
    expect(seen).toEqual([]);
    tap(c);
    expect(seen).toEqual([true]);
    c.provider().emitStart();
    c.provider().emitInterim('lo');
    expect(seen).toEqual([true]);
    c.provider().emitFinal(['look']);
    expect(seen).toEqual([true]); // finished but not ended: still listening
    c.provider().emitEnd();
    expect(seen).toEqual([true, false]);
    expect(c.layer.listening).toBe(false);
  });

  it('notifies false on abort and not twice for the same value', () => {
    const c = setup();
    const seen: boolean[] = [];
    c.layer.subscribe((l) => seen.push(l));
    tap(c);
    c.layer.port.dispatch({ type: 'escape' });
    c.layer.port.dispatch({ type: 'escape' });
    expect(seen).toEqual([true, false]);
  });

  it('unsubscribe stops notifications; a throwing listener does not block others', () => {
    const c = setup();
    const a: boolean[] = [];
    const b: boolean[] = [];
    c.layer.subscribe(() => {
      throw new Error('boom');
    });
    const offA = c.layer.subscribe((l) => a.push(l));
    c.layer.subscribe((l) => b.push(l));
    tap(c);
    expect(a).toEqual([true]);
    expect(b).toEqual([true]);
    offA();
    c.layer.port.dispatch({ type: 'escape' });
    expect(a).toEqual([true]);
    expect(b).toEqual([true, false]);
  });
});
