// Feature: voice-input, task 13.2 (Requirements 12.7, 12.11, 12.13, 17.8, 18.7).
// Replays the upstream win430.log through the GameController in Haunted mode three
// times (no Voice_Layer; Voice_Layer installed but Unavailable; every magic-word line
// spoken as its own Voice_Session), then a fourth time with a Ready stub layer and a
// typed XYZZY. The final score is read from the last `game-over` event (430), not the
// `score` event (426: the end-of-game bonuses are only added into game-over).
// Seed and options follow tests/ui/win430.test.ts (and so the upstream harness).

import { describe, expect, it } from 'vitest';
import type { OutputEvent } from '../../src/engine/index';
import { render } from '../../src/engine/index';
import { DEFLECTION_LINE, createSpokenWordGate } from '../../src/haunt/spoken-word-rule';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import type { GateResult, InputGate } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { InputOrigin } from '../../src/ui/types';
import type { VoiceLayer } from '../../src/ui/voice-port';
import { RESULT_WAIT_MS } from '../../src/voice/config';
import type { DetectEnv } from '../../src/voice/detect';
import { createVoiceLayer } from '../../src/voice/session-controller';
import type { ControllerLayer } from '../../src/voice/session-controller';
import {
  HARNESS_DEFAULT_SEED,
  parseOptions,
  readUpstream,
  replayLog,
  splitLog,
} from '../replay-harness';
import { createFakeProviderFactory } from '../voice/support/fake-provider';
import { FakeScheduler } from '../voice/support/fake-scheduler';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

/** Lines that the third run speaks. The upstream log abbreviates PLOVER to `plove`. */
const MAGIC_LINE = /^(xyzzy|plugh|plover|plove|fee|fie|foe|foo)$/i;

interface RunResult {
  readonly score: number | undefined;
  readonly status: string | undefined;
  readonly original: string;
  readonly deflects: number;
  /** The controller's Deflection_Count after the last line (seen by the observer gate). */
  readonly deflectionCount: number;
  readonly deflectionLines: number;
  readonly errors: readonly unknown[];
  readonly spokenSubmits: readonly { line: string; origin: InputOrigin }[];
  readonly sessions: number;
  readonly availability: string | undefined;
  readonly usable: boolean | undefined;
}

type LayerMode = 'none' | 'unavailable' | 'speak' | 'stub';

/**
 * Runs the lines through a fresh controller. Lines are typed, except that in
 * 'speak' mode every magic-word line is spoken as its own Voice_Session.
 * As in src/voice-loader.ts, the real Spoken_Word_Rule gate is registered only
 * when a Voice_Layer exists, and it reads `layer.usable`.
 */
function run(lines: readonly string[], layerMode: LayerMode, stub?: VoiceLayer): RunResult {
  const logText = readUpstream('win430.log');
  const options = parseOptions(logText);
  const clock = new FakeClock(HARNESS_DEFAULT_SEED);
  const kv = new MemoryKeyValueStore();
  kv.set(
    SETTINGS_KEY,
    printSettings({ mode: options.oldstyle ? '1976' : 'haunted', speed: 'instant', crt: true }),
  );
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const hooks = new ExtensionHooks(log);
  const gameOvers: Extract<OutputEvent, { type: 'game-over' }>[] = [];
  hooks.addEventObserver((events) => {
    for (const e of events) if (e.type === 'game-over') gameOvers.push(e);
  });

  // An always-allow observer registered first sees the controller's Deflection_Count
  // for every gated line; the real gate after it decides.
  let lastCount = 0;
  let lastDeflected = false;
  let deflects = 0;
  hooks.addInputGate((_text, _origin, count) => {
    lastCount = count;
    lastDeflected = false;
    return { kind: 'allow' };
  });

  let layer: VoiceLayer | ControllerLayer | undefined = layerMode === 'stub' ? stub : undefined;
  if (layerMode !== 'none') {
    const real = createSpokenWordGate({ isVoiceUsable: () => layer?.usable ?? false });
    const counting: InputGate = (text, origin, count, ctx): GateResult => {
      const r = real(text, origin, count, ctx);
      if (r.kind === 'deflect') {
        deflects += 1;
        lastDeflected = true;
      }
      return r;
    };
    hooks.addInputGate(counting);
  }

  const spokenSubmits: { line: string; origin: InputOrigin }[] = [];
  const scheduler = new FakeScheduler();
  const providers = createFakeProviderFactory();
  // Assigned right after construction; the layer only reads it after the controller exists.
  let controllerRef: GameController | undefined;

  const controller = new GameController({
    kv,
    clock,
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    onGameStart: (mode) => layer?.gameStart(mode),
  });
  controllerRef = controller;

  if (layerMode === 'unavailable' || layerMode === 'speak') {
    const env: DetectEnv = {
      isSecureContext: true,
      hasRecognition: () => true,
      // 'unavailable': the detection probe throws, so the layer ends Unavailable.
      probe: () => {
        if (layerMode === 'unavailable') throw new Error('no speech service');
      },
      log: () => {},
    };
    layer = createVoiceLayer({
      host: {
        submit: (line, origin) => {
          spokenSubmits.push({ line, origin });
          controllerRef?.submit(line, origin);
        },
        get promptKind() {
          return controllerRef?.promptKind;
        },
        get phase() {
          return controllerRef?.phase;
        },
        get gameMode() {
          return controllerRef?.gameMode;
        },
        log,
      },
      createProvider: providers.factory,
      scheduler,
      env,
    });
  }

  controller.startBoot();
  controller.tick(0);
  controller.skip(); // the boot is revealed at once; the game starts
  expect(controller.phase).toBe('ready');
  expect(controller.gameMode).toBe('haunted');

  const speak = (line: string): void => {
    if (layer === undefined) throw new Error('no layer to speak through');
    layer.port.dispatch({ type: 'button-activate', via: 'touch' });
    const provider = providers.provider;
    if (provider === undefined) throw new Error('provider was never built');
    provider.emitStart();
    provider.emitFinal([line]);
    provider.emitEnd();
    scheduler.advance(RESULT_WAIT_MS * 2);
  };

  for (const line of lines) {
    if (controller.phase !== 'ready') break;
    const word = line.trim().toLowerCase();
    // A speech engine hears the whole word: the log's `plove` is spoken as "plover".
    if (layerMode === 'speak' && MAGIC_LINE.test(word)) speak(word === 'plove' ? 'plover' : word);
    else controller.submit(line);
  }
  controller.tick(0);

  const last = gameOvers[gameOvers.length - 1];
  const view0 = layer?.port.getView();
  return {
    score: last?.score,
    status: controller.engineState?.session.status,
    original: view.textOfKind('original'),
    deflects,
    deflectionCount: lastCount + (lastDeflected ? 1 : 0),
    deflectionLines: view.blocks.filter(
      (b) => b.kind === 'narrator' && b.text === DEFLECTION_LINE + '\n',
    ).length,
    errors: log.entries,
    spokenSubmits,
    sessions: providers.provider?.startCount ?? 0,
    availability: view0?.availability,
    usable: layer?.usable,
  };
}

const logLines = (): readonly string[] => splitLog(readUpstream('win430.log'));
const magicLines = (): string[] =>
  logLines()
    .map((l) => l.trim().toLowerCase())
    .filter((l) => MAGIC_LINE.test(l));

describe('win430 three-run replay with the voice layer (Requirement 18.7)', () => {
  const expected = render(replayLog('win430').events, { echo: false });
  const baseline = run(logLines(), 'none');

  it('the upstream log types XYZZY and the other magic words', () => {
    const words = magicLines();
    expect(words).toContain('xyzzy');
    expect(words).toContain('plugh');
    expect(words).toContain('plove');
    for (const w of ['fee', 'fie', 'foe', 'foo']) expect(words).toContain(w);
  });

  it('run 1: no Voice_Layer reaches 430 with the engine text unchanged', () => {
    expect(baseline.errors).toEqual([]);
    expect(baseline.status).toBe('over');
    expect(baseline.score).toBe(430);
    expect(baseline.original).toBe(expected);
    expect(baseline.deflectionCount).toBe(0);
    expect(baseline.deflectionLines).toBe(0);
  });

  it('run 2: layer installed and Unavailable, typed XYZZY, same text and 430', () => {
    const r = run(logLines(), 'unavailable');
    expect(r.availability).toBe('Unavailable');
    expect(r.usable).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.status).toBe('over');
    expect(r.score).toBe(430);
    expect(r.original).toBe(baseline.original);
    expect(r.deflects).toBe(0);
    expect(r.deflectionCount).toBe(0);
    expect(r.deflectionLines).toBe(0);
    expect(r.spokenSubmits).toEqual([]);
    expect(r.sessions).toBe(0);
  });

  it('run 3: every magic-word line is its own spoken Voice_Session, same text and 430', () => {
    const words = magicLines();
    const r = run(logLines(), 'speak');
    expect(r.availability).toBe('Ready');
    expect(r.errors).toEqual([]);
    expect(r.sessions).toBe(words.length);
    // One spoken line per session, the same command word (first 5 letters) as the log.
    expect(r.spokenSubmits.map((s) => s.origin)).toEqual(words.map(() => 'spoken'));
    expect(r.spokenSubmits.map((s) => s.line.toLowerCase().slice(0, 5))).toEqual(
      words.map((w) => w.slice(0, 5)),
    );
    expect(r.status).toBe('over');
    expect(r.score).toBe(430);
    expect(r.original).toBe(baseline.original);
    expect(r.deflects).toBe(0);
    expect(r.deflectionCount).toBe(0);
    expect(r.deflectionLines).toBe(0);
  });
});

describe('typed-only completion with a Ready layer (Requirement 12.13)', () => {
  it('the first typed XYZZY is deflected once; typed again, the game reaches 430', () => {
    const base = logLines();
    const first = base.findIndex((l) => l.trim().toLowerCase() === 'xyzzy');
    expect(first).toBeGreaterThan(0);
    // Every XYZZY is typed; the first one twice (a Deflection takes no turn).
    const lines = [...base.slice(0, first + 1), base[first]!, ...base.slice(first + 1)];
    const starts: string[] = [];
    const stub: VoiceLayer = {
      port: {
        getView: () => ({
          availability: 'Ready',
          pressed: false,
          disabled: false,
          status: '',
          announcement: null,
        }),
        onView: () => () => {},
        dispatch: () => ({ preventDefault: false }),
      },
      usable: true,
      listening: false,
      subscribe: () => () => {},
      gameStart: (mode) => {
        starts.push(mode);
      },
      syncHost: () => {},
    };
    const r = run(lines, 'stub', stub);
    const baseline = run(logLines(), 'none');
    expect(starts).toEqual(['haunted']);
    expect(r.errors).toEqual([]);
    expect(r.deflects).toBe(1);
    expect(r.deflectionCount).toBe(1);
    expect(r.deflectionLines).toBe(1);
    expect(r.status).toBe('over');
    expect(r.score).toBe(430);
    expect(r.original).toBe(baseline.original);
  });
});
