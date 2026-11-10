// Error and start-failure example tests for the Voice_Layer shell
// (spec: voice-input, task 8.10; Requirements 2.14, 5.8, 7.1-7.8, 7.10, 7.12,
// 7.13, 7.17). Drives createVoiceLayer with the tests/voice/support fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_CLEAR_MS } from '../../src/voice/config';
import type { DetectEnv } from '../../src/voice/detect';
import * as messages from '../../src/voice/messages';
import {
  NO_MICROPHONE,
  NOTHING_HEARD,
  SERVICE_NOT_ANSWERING,
  VOICE_NOT_AVAILABLE,
  VOICE_TROUBLE,
} from '../../src/voice/messages';
import { createVoiceLayer } from '../../src/voice/session-controller';
import {
  initialState,
  reduce,
  type GestureEvent,
  type ReduceContext,
  type VoiceEvent,
  type VoiceState,
  type VoiceView,
} from '../../src/voice/session-machine';
import type { ProviderCallbacks, VoiceErrorCode } from '../../src/voice/speech-provider';
import { FakeHost } from './support/fake-host';
import { FakePermissions } from './support/fake-permissions';
import { FakeSpeechProvider } from './support/fake-provider';
import { FakeScheduler } from './support/fake-scheduler';

interface Rig {
  host: FakeHost;
  scheduler: FakeScheduler;
  env: DetectEnv & { logged: VoiceErrorCode[] };
  layer: ReturnType<typeof createVoiceLayer>;
  provider: () => FakeSpeechProvider;
  callbacks: () => ProviderCallbacks;
  views: VoiceView[];
  announcements: () => { seq: number; text: string }[];
  press: () => void;
}

function setup(
  opts: {
    startThrows?: unknown;
    probeThrows?: boolean;
    permissions?: FakePermissions;
  } = {},
): Rig {
  const host = new FakeHost();
  const scheduler = new FakeScheduler();
  const logged: VoiceErrorCode[] = [];
  const env: Rig['env'] = {
    isSecureContext: true,
    hasRecognition: () => true,
    probe: () => {
      if (opts.probeThrows) throw new Error('probe boom');
    },
    log: (code) => {
      logged.push(code);
    },
    logged,
    ...(opts.permissions
      ? { queryMicrophone: () => opts.permissions!.query({ name: 'microphone' }) as never }
      : {}),
  };
  let made: FakeSpeechProvider | undefined;
  let cbs: ProviderCallbacks | undefined;
  const layer = createVoiceLayer({
    host,
    scheduler,
    env,
    createProvider: (callbacks) => {
      cbs = callbacks;
      made = new FakeSpeechProvider(callbacks, { startThrows: opts.startThrows });
      return made;
    },
  });
  const views: VoiceView[] = [];
  layer.port.onView((v) => views.push(v));
  layer.gameStart('haunted');
  const announcements = (): { seq: number; text: string }[] => {
    const seen = new Map<number, string>();
    for (const v of views) if (v.announcement) seen.set(v.announcement.seq, v.announcement.text);
    return [...seen].map(([seq, text]) => ({ seq, text }));
  };
  return {
    host,
    scheduler,
    env,
    layer,
    provider: () => {
      if (!made) throw new Error('provider not built yet');
      return made;
    },
    callbacks: () => {
      if (!cbs) throw new Error('provider not built yet');
      return cbs;
    },
    views,
    announcements,
    press: () => {
      layer.port.dispatch({ type: 'button-activate', via: 'keyboard' });
    },
  };
}

const view = (r: Rig): VoiceView => r.layer.port.getView();

/** One session ending with `code`, then the provider end event. */
function failSession(r: Rig, code: VoiceErrorCode): void {
  r.press();
  r.provider().emitError(code);
  r.provider().emitEnd();
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROWS: ReadonlyArray<readonly [VoiceErrorCode, string, 'Ready' | 'Unavailable']> = [
  ['denied', VOICE_NOT_AVAILABLE, 'Unavailable'],
  ['unsupported-language', VOICE_NOT_AVAILABLE, 'Unavailable'],
  ['no-device', NO_MICROPHONE, 'Unavailable'],
  ['network', SERVICE_NOT_ANSWERING, 'Ready'],
  ['other', VOICE_TROUBLE, 'Ready'],
  ['no-speech', NOTHING_HEARD, 'Ready'],
];

describe('message rows (Requirements 7.1 to 7.6, 7.12, 7.16)', () => {
  it.each(ROWS)('%s shows its message, availability, one announcement, one code-only log', (code, text, availability) => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    expect(view(r).status).toBe(messages.LISTENING);
    r.provider().emitError(code);
    expect(view(r).status).toBe(text); // replaces LISTENING... at once
    expect(r.host.submitted).toEqual([]);
    r.provider().emitEnd();
    expect(view(r).availability).toBe(availability);
    expect(view(r).status).toBe(text);
    expect(r.announcements().map((a) => a.text)).toEqual([text]);
    expect(r.host.logged).toEqual([{ message: 'voice: ' + code, cause: undefined }]);
  });

  it('aborted from the provider shows nothing, announces nothing, logs nothing, stays Ready', () => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    r.provider().emitError('aborted');
    r.provider().emitEnd();
    expect(view(r).status).toBe('');
    expect(view(r).availability).toBe('Ready');
    expect(r.announcements()).toEqual([]);
    expect(r.host.logged).toEqual([]);
    expect(r.host.submitted).toEqual([]);
  });

  it.each(ROWS)('%s message clears at STATUS_CLEAR_MS even when the button is hidden', (code, text) => {
    const r = setup();
    failSession(r, code);
    r.scheduler.advance(STATUS_CLEAR_MS - 1);
    expect(view(r).status).toBe(text);
    r.scheduler.advance(1);
    expect(view(r).status).toBe('');
  });

  it('a HEARD: preview is replaced by the error message', () => {
    const r = setup();
    r.press();
    r.provider().emitInterim('open the door');
    expect(view(r).status).toBe('HEARD: open the door');
    r.provider().emitError('network');
    expect(view(r).status).toBe(SERVICE_NOT_ANSWERING);
  });
});

describe('permanent hiding (Requirements 7.1, 7.2, 7.8, 2.14)', () => {
  it.each([
    ['denied (not-allowed / service-not-allowed)', 'denied'],
    ['unsupported-language (language-not-supported)', 'unsupported-language'],
  ] as const)('%s hides for the rest of the page lifetime', (_name, code) => {
    const r = setup();
    failSession(r, code);
    expect(view(r).availability).toBe('Unavailable');
    r.provider().clearLog();
    // No later start request reaches the provider.
    r.press();
    r.layer.port.dispatch({ type: 'pointer-down', pointerType: 'mouse' });
    r.layer.port.dispatch({ type: 'altm-down', repeat: false });
    expect(r.provider().startCalls).toBe(0);
    expect(r.layer.usable).toBe(false);
    // Survives a 1976 game and a later Haunted game.
    r.layer.gameStart('1976');
    expect(view(r).availability).toBe('Suspended');
    r.layer.gameStart('haunted');
    expect(view(r).availability).toBe('Unavailable');
    expect(r.env.logged).toEqual([]);
  });

  it('no-device and three-in-a-row hides also survive a 1976 and a later Haunted game', () => {
    const a = setup();
    failSession(a, 'no-device');
    a.layer.gameStart('1976');
    a.layer.gameStart('haunted');
    expect(view(a).availability).toBe('Unavailable');

    const b = setup();
    failSession(b, 'other');
    failSession(b, 'other');
    failSession(b, 'network');
    b.layer.gameStart('1976');
    b.layer.gameStart('haunted');
    expect(view(b).availability).toBe('Unavailable');
  });

  it('a runtime Unavailable is not reversed by granted or prompt', async () => {
    const permissions = new FakePermissions('prompt');
    const r = setup({ permissions });
    await flush();
    failSession(r, 'denied');
    expect(view(r).availability).toBe('Unavailable');
    permissions.status.state = 'granted';
    permissions.status.state = 'prompt';
    expect(view(r).availability).toBe('Unavailable');
  });
});

describe('permission-based Unavailable (Requirement 7.8, 2.5)', () => {
  it('is reversed only by granted or prompt, and not while suspended', async () => {
    const permissions = new FakePermissions('denied');
    const r = setup({ permissions });
    await flush();
    expect(view(r).availability).toBe('Unavailable');
    expect(permissions.queries).toHaveLength(1);

    // Suspended: a Mode_1976 game; the change is ignored.
    r.layer.gameStart('1976');
    permissions.status.state = 'granted';
    r.layer.gameStart('haunted');
    expect(view(r).availability).toBe('Unavailable');
    expect(permissions.queries).toHaveLength(1); // detection and query ran once

    permissions.status.state = 'prompt';
    expect(view(r).availability).toBe('Ready');
    permissions.status.state = 'denied';
    expect(view(r).availability).toBe('Unavailable');
    permissions.status.state = 'granted';
    expect(view(r).availability).toBe('Ready');
  });
});

describe('start() throws synchronously (Requirements 2.14, 5.8, 7.17)', () => {
  const gestures: ReadonlyArray<readonly [string, GestureEvent]> = [
    ['mouse press', { type: 'pointer-down', pointerType: 'mouse' }],
    ['touch click', { type: 'button-activate', via: 'touch' }],
    ['keyboard activation', { type: 'button-activate', via: 'keyboard' }],
    ['Alt+M', { type: 'altm-down', repeat: false }],
  ];

  it.each(gestures)('first %s: Unavailable, calm message, one other, no retry', (_name, gesture) => {
    const r = setup({ startThrows: Object.assign(new Error('not-allowed secret detail'), { name: 'NotAllowedError' }) });
    r.layer.port.dispatch(gesture);
    expect(r.provider().startCalls).toBe(1);
    expect(view(r).availability).toBe('Unavailable');
    expect(view(r).pressed).toBe(false);
    expect(r.layer.listening).toBe(false);
    expect(view(r).status).toBe(VOICE_NOT_AVAILABLE);
    expect(r.announcements().map((a) => a.text)).toEqual([VOICE_NOT_AVAILABLE]);
    expect(r.host.submitted).toEqual([]);
    expect(r.host.logged).toEqual([{ message: 'voice: other', cause: undefined }]);
    expect(JSON.stringify(r.host.logged)).not.toContain('secret');

    // No later start request calls start again; the start-confirm timer is gone.
    r.layer.port.dispatch({ type: 'pointer-up', pointerType: 'mouse' });
    r.layer.port.dispatch({ type: 'altm-up' });
    for (const [, g] of gestures) r.layer.port.dispatch(g);
    r.scheduler.advance(20000);
    expect(r.provider().startCalls).toBe(1);
    expect(r.host.logged).toHaveLength(1);
    expect(r.announcements()).toHaveLength(1);
    expect(view(r).availability).toBe('Unavailable');
    expect(view(r).status).toBe(''); // cleared after STATUS_CLEAR_MS
  });

  it('shows the message until STATUS_CLEAR_MS', () => {
    const r = setup({ startThrows: new Error('x') });
    r.press();
    r.scheduler.advance(STATUS_CLEAR_MS - 1);
    expect(view(r).status).toBe(VOICE_NOT_AVAILABLE);
    r.scheduler.advance(1);
    expect(view(r).status).toBe('');
  });

  it('leaves the failure counter unchanged (reducer level)', () => {
    const ctx: ReduceContext = { now: 0, host: { gameMode: 'haunted', promptKind: 'command', phase: 'ready' } };
    let s: VoiceState = initialState();
    const step = (e: VoiceEvent): void => {
      s = reduce(s, e, ctx).state;
    };
    step({ type: 'detected', fatal: null });
    step({ type: 'game-start', mode: 'haunted' });
    for (let i = 0; i < 2; i++) {
      step({ type: 'button-activate', via: 'keyboard' });
      step({ type: 'p-start' });
      step({ type: 'p-error', code: 'network' });
      step({ type: 'p-end' });
    }
    expect(s.failures).toBe(2);
    step({ type: 'button-activate', via: 'keyboard' });
    step({ type: 'start-threw' });
    expect(s.failures).toBe(2);
    expect(s.fatal).toBe('runtime');
  });

  it('a browser that exposes the API but whose probe throws ends Unavailable with one other', () => {
    const r = setup({ probeThrows: true });
    expect(view(r).availability).toBe('Unavailable');
    expect(r.env.logged).toEqual(['other']);
    r.press();
    expect(() => r.provider()).toThrow(); // never built: start was never requested
  });

  it('survives a 1976 game and a later Haunted game start, without a new attempt', () => {
    const r = setup({ startThrows: new Error('x') });
    r.press();
    r.layer.gameStart('1976');
    r.layer.gameStart('haunted');
    expect(view(r).availability).toBe('Unavailable');
    r.press();
    expect(r.provider().startCalls).toBe(1);
  });
});

describe('repeated-error rule (Requirement 7.7, 7.13)', () => {
  it('hides at the third consecutive network/other, showing the last message', () => {
    const r = setup();
    failSession(r, 'network');
    expect(view(r).availability).toBe('Ready');
    failSession(r, 'other');
    expect(view(r).availability).toBe('Ready');
    failSession(r, 'network');
    expect(view(r).availability).toBe('Unavailable');
    expect(view(r).status).toBe(SERVICE_NOT_ANSWERING);
    expect(r.host.logged.map((l) => l.message)).toEqual(['voice: network', 'voice: other', 'voice: network']);
  });

  it('shows the other message when the third failure is other', () => {
    const r = setup();
    failSession(r, 'other');
    failSession(r, 'other');
    failSession(r, 'other');
    expect(view(r).availability).toBe('Unavailable');
    expect(view(r).status).toBe(VOICE_TROUBLE);
  });

  it('a processed final resets the counter', () => {
    const r = setup();
    failSession(r, 'network');
    failSession(r, 'network');
    r.press();
    r.provider().emitFinal(['look']);
    r.provider().emitEnd();
    expect(r.host.lines).toEqual(['look']);
    failSession(r, 'network');
    failSession(r, 'network');
    expect(view(r).availability).toBe('Ready');
    failSession(r, 'network');
    expect(view(r).availability).toBe('Unavailable');
  });

  it('no-speech (error or empty end) resets the counter', () => {
    const r = setup();
    failSession(r, 'other');
    failSession(r, 'other');
    failSession(r, 'no-speech');
    failSession(r, 'other');
    failSession(r, 'other');
    expect(view(r).availability).toBe('Ready');
    // End without any result is also no-speech.
    r.press();
    r.provider().emitEnd();
    expect(view(r).status).toBe(NOTHING_HEARD);
    failSession(r, 'other');
    failSession(r, 'other');
    expect(view(r).availability).toBe('Ready');
  });

  it('aborted leaves the counter unchanged and a new game does not reset it', () => {
    const r = setup();
    failSession(r, 'other');
    r.press();
    r.provider().emitStart();
    r.layer.port.dispatch({ type: 'escape' });
    r.layer.gameStart('haunted');
    failSession(r, 'network');
    expect(view(r).availability).toBe('Ready');
    failSession(r, 'network');
    expect(view(r).availability).toBe('Unavailable');
  });
});

describe('one error code per session (Requirement 7.14)', () => {
  it('applies only the first error and ignores later ones', () => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    r.callbacks().onError('network');
    r.callbacks().onError('denied');
    r.callbacks().onError('other');
    r.callbacks().onEnd();
    expect(view(r).availability).toBe('Ready');
    expect(view(r).status).toBe(SERVICE_NOT_ANSWERING);
    expect(r.announcements().map((a) => a.text)).toEqual([SERVICE_NOT_ANSWERING]);
    expect(r.host.logged.map((l) => l.message)).toEqual(['voice: network']);
  });

  it('discards an error after a processed final', () => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    r.callbacks().onFinal(['look']);
    const before = view(r);
    r.callbacks().onError('denied');
    r.callbacks().onEnd();
    expect(view(r).availability).toBe('Ready');
    expect(view(r).status).toBe(before.status);
    expect(r.host.logged).toEqual([]);
  });

  it('discards an error after an abort', () => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    r.layer.port.dispatch({ type: 'escape' });
    r.callbacks().onError('denied');
    expect(view(r).availability).toBe('Ready');
    expect(view(r).status).toBe('');
    expect(r.host.logged).toEqual([]);
    expect(r.announcements()).toEqual([]);
  });

  it('discards an error while Suspended', () => {
    const r = setup();
    r.press();
    r.provider().emitStart();
    r.layer.gameStart('1976');
    r.callbacks().onError('denied');
    expect(view(r).availability).toBe('Suspended');
    expect(view(r).status).toBe('');
    expect(r.host.logged).toEqual([]);
    r.layer.gameStart('haunted');
    expect(view(r).availability).toBe('Ready');
  });

  it('the end after an error does not add NOTHING HEARD', () => {
    const r = setup();
    failSession(r, 'other');
    expect(view(r).status).toBe(VOICE_TROUBLE);
    expect(r.announcements()).toHaveLength(1);
  });
});

describe('message word rules (Requirement 7.10)', () => {
  const strings = Object.entries(messages).filter(
    (e) => typeof e[1] === 'string',
  ) as Array<[string, string]>;

  it('exports message strings to check', () => {
    expect(strings.length).toBeGreaterThanOrEqual(9);
  });

  it.each(strings)('%s avoids the forbidden sequences and words', (_name, text) => {
    expect(text).not.toMatch(/error|failed|denied|danger|warning|system/i);
    expect(text).not.toMatch(/exception|crash|fatal/i);
  });

  it('every message the layer actually shows or announces satisfies the rules', () => {
    for (const [code] of ROWS) {
      const r = setup();
      failSession(r, code);
      const texts = [view(r).status, ...r.announcements().map((a) => a.text)];
      for (const t of texts) {
        expect(t).not.toMatch(/error|failed|denied|danger|warning|system|exception|crash|fatal/i);
      }
    }
  });
});

describe('console and storage hygiene (Requirements 7.12, 14.8, 14.9, 14.12, 18.6, 18.13)', () => {
  it('console entries carry only the code, never spoken text or raw provider strings', () => {
    const r = setup();
    // A session with spoken text, then one with an error.
    r.press();
    r.provider().emitInterim('open the secret door');
    r.provider().emitFinal(['open the secret door']);
    r.provider().emitEnd();
    expect(r.host.lines).toEqual(['open the secret door']);
    failSession(r, 'network');
    failSession(r, 'other');
    expect(r.host.logged.length).toBeGreaterThan(0);
    for (const entry of r.host.logged) {
      expect(entry.message).toMatch(/^voice: (denied|no-device|unsupported-language|network|no-speech|other)$/);
      expect(entry.cause).toBeUndefined();
    }
    expect(JSON.stringify(r.host.logged).toLowerCase()).not.toContain('secret');
    expect(r.env.logged).toEqual([]);
  });

  it('exactly one console entry per failed session', () => {
    const r = setup();
    failSession(r, 'network');
    expect(r.host.logCount).toBe(1);
    failSession(r, 'no-speech');
    expect(r.host.logCount).toBe(2);
  });

  it('touches no storage during a full session (first press, result, error)', () => {
    const get = vi.fn();
    const set = vi.fn();
    const spy = { getItem: get, setItem: set, removeItem: set, clear: set, key: get, length: 0 };
    vi.stubGlobal('localStorage', spy);
    vi.stubGlobal('sessionStorage', spy);
    const r = setup();
    r.press();
    r.provider().emitFinal(['look']);
    r.provider().emitEnd();
    failSession(r, 'denied');
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('typed lines are unaffected (Requirement 7.11)', () => {
  it.each(ROWS)('after %s the host is unchanged and typed lines still go through in order', (code) => {
    const r = setup();
    const snapshot = { p: r.host.promptKind, ph: r.host.phase, m: r.host.gameMode };
    r.host.submit('look', 'typed');
    failSession(r, code);
    r.host.submit('north', 'typed');
    expect({ p: r.host.promptKind, ph: r.host.phase, m: r.host.gameMode }).toEqual(snapshot);
    expect(r.host.submitted).toEqual([
      { line: 'look', origin: 'typed' },
      { line: 'north', origin: 'typed' },
    ]);
  });
});
