// Feature: ai-parser, task 10.1: 1976 isolation with the AI parser installed.
// Real GameController + real AiParser (fetch replaced by FakeFetch, a spy):
//  - in 1976 mode the fetch spy is never called and the `original` text is unchanged;
//  - every upstream log replayed through the controller in 1976 mode matches the run
//    without a resolver and, where the log is an oldstyle log, the harness and its .chk;
//  - the 430-point walkthrough is identical with the AI parser installed;
//  - Haunted mode with classic commands and an always-failing fetch is unchanged.
// Requirements: 1.1, 1.2, 5.5, 13.4, 13.10.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { endOfInput, render } from '../../src/engine/index';
import type { Env, OutputEvent } from '../../src/engine/index';
import { AiParser } from '../../src/parser/ai-parser';
import { clearAutosave } from '../../src/ui/autosave';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { FILE_PREFIX, SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { Mode } from '../../src/ui/types';
import { SKIP_NAMES } from '../fidelity-skip-list';
import {
  FIXTURE_DEPENDENCIES,
  HARNESS_DEFAULT_SEED,
  MemoryStorage,
  STATIC_FIXTURES,
  checkLog,
  discoverLogs,
  parseOptions,
  readUpstream,
  replayLog,
  splitLog,
} from '../replay-harness';
import { FakeFetch } from '../support/ai-client-fakes';
import type { FetchBehavior } from '../support/ai-client-fakes';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

interface Run {
  /** Concatenated text of every `original` block. */
  original: string;
  /** Chk-comparable text: opening text, then each typed line followed by its output. */
  transcript: string;
  fetchCalls: number;
  gameOvers: Extract<OutputEvent, { type: 'game-over' }>[];
  phase: string;
  controller: GameController;
  errors: number;
}

interface RunOptions {
  mode: Mode;
  lines: readonly string[];
  withAi: boolean;
  fetchScript?: FetchBehavior[];
  /** Existing store, for dependency logs. */
  kv?: MemoryKeyValueStore;
  /** Files pre-loaded into the save store. */
  fixtures?: Readonly<Record<string, string>>;
}

function newKv(mode: Mode, fixtures: Readonly<Record<string, string>> = {}): MemoryKeyValueStore {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode, speed: 'instant', crt: true }));
  for (const [name, data] of Object.entries(fixtures)) kv.set(FILE_PREFIX + name, data);
  return kv;
}

function runController(opts: RunOptions): Run {
  const kv = opts.kv ?? newKv(opts.mode, opts.fixtures);
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const hooks = new ExtensionHooks(log);
  const gameOvers: Extract<OutputEvent, { type: 'game-over' }>[] = [];
  hooks.addEventObserver((events) => {
    for (const e of events) if (e.type === 'game-over') gameOvers.push(e);
  });
  const controller = new GameController({
    kv,
    clock: new FakeClock(HARNESS_DEFAULT_SEED),
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
  });
  const fake = new FakeFetch(opts.fetchScript);
  if (opts.withAi) {
    const parser = new AiParser({
      fetch: (input, init) => fake.fetch(input, init),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isOnline: () => true,
      log: { error: (m, c) => log.error(m, c) },
    });
    controller.setInputResolver(parser);
  }

  controller.startBoot();
  controller.tick(0);
  controller.skip();

  const submitted: string[] = [];
  for (const line of opts.lines) {
    if (controller.phase !== 'ready') break;
    controller.submit(line);
    controller.tick(0);
    submitted.push(line);
  }
  controller.tick(0);

  // Chk-comparable reconstruction: boot blocks are not 'original'; input lines are instant.
  let transcript = '';
  let inputIndex = 0;
  const blockText = new Map(view.blocks.map((b) => [b.id, b]));
  for (const call of view.calls) {
    if (call.method === 'appendInstant') {
      for (const l of call.lines) {
        // The engine drops '#' comment lines silently (C: get_input), so stdout has no echo.
        if (l.kind === 'input') {
          const typed = submitted[inputIndex++] ?? '';
          if (!typed.startsWith('#')) transcript += typed + '\n';
        }
      }
    } else if (call.method === 'beginBlock' && call.block.kind === 'original') {
      transcript += blockText.get(call.block.id)?.revealed ?? '';
    }
  }

  return {
    original: view.textOfKind('original'),
    transcript,
    fetchCalls: fake.callCount,
    gameOvers,
    phase: controller.phase,
    controller,
    errors: log.entries.length,
  };
}

const NON_CLASSIC = [
  "I'll go inside the building please",
  'could you pick up the shiny lamp for me',
  'what is that over there?',
  'xyzzy plugh please',
  '',
  '   ',
];

describe('1976 mode: the AI parser is never called', () => {
  it('arbitrary lines: zero fetch calls and the original text equals the run without a resolver', () => {
    const arbLine = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.string({ unit: 'binary', maxLength: 40 }),
      fc.constantFrom(...NON_CLASSIC, 'look', 'go west', 'take lamp', 'enter building', 'yes', 'no'),
    );
    fc.assert(
      fc.property(fc.array(arbLine, { maxLength: 12 }), (lines) => {
        const plain = runController({ mode: '1976', lines, withAi: false });
        const withAi = runController({ mode: '1976', lines, withAi: true });
        expect(withAi.fetchCalls).toBe(0);
        expect(withAi.original).toBe(plain.original);
        expect(withAi.errors).toBe(plain.errors);
      }),
      { numRuns: 100 },
    );
  });

  it('natural-language sentences never reach fetch, even in a running 1976 game', () => {
    const run = runController({ mode: '1976', lines: NON_CLASSIC, withAi: true });
    expect(run.controller.gameMode).toBe('1976');
    expect(run.fetchCalls).toBe(0);
  });
});

/** Controller-side runs of one upstream log (dependency logs first, same store). */
function controllerReplay(name: string, withAi: boolean): Run {
  const kv = newKv('1976', STATIC_FIXTURES);
  const deps: string[] = [];
  const collect = (n: string): void => {
    for (const d of FIXTURE_DEPENDENCIES[n] ?? []) {
      if (deps.includes(d)) continue;
      collect(d);
      deps.push(d);
    }
  };
  collect(name);
  let fetchCalls = 0;
  for (const d of deps) {
    const r = runController({
      mode: '1976',
      lines: splitLog(readUpstream(`${d}.log`)),
      withAi,
      kv,
    });
    fetchCalls += r.fetchCalls;
    clearAutosave(kv);
  }
  const run = runController({
    mode: '1976',
    lines: splitLog(readUpstream(`${name}.log`)),
    withAi,
    kv,
  });
  return { ...run, fetchCalls: fetchCalls + run.fetchCalls };
}

describe('1976 mode: upstream logs through the controller with the AI parser installed', () => {
  const logs = discoverLogs();
  it('discovers upstream logs', () => {
    expect(logs.length).toBeGreaterThan(0);
  });

  for (const name of logs) {
    if (SKIP_NAMES.has(name)) {
      it.skip(`${name} (skipped: same Skip_List as the fidelity suite)`, () => {});
      continue;
    }
    it(name, () => {
      const plain = controllerReplay(name, false);
      const withAi = controllerReplay(name, true);

      expect(withAi.fetchCalls, `${name}: fetch calls`).toBe(0);
      expect(withAi.original, `${name}: original text with AI parser`).toBe(plain.original);
      expect(withAi.transcript).toBe(plain.transcript);
      expect(withAi.errors).toBe(plain.errors);

      // Where the harness runs the same options (oldstyle) and compares to a .chk,
      // the controller output equals the .chk byte for byte.
      const options = parseOptions(readUpstream(`${name}.log`));
      if (!options.oldstyle || options.restoreFile !== undefined) return;
      const chk = checkLog(name);
      if (!chk.pass) expect.fail(chk.message);
      let actual = withAi.transcript;
      const state = withAi.controller.engineState;
      if (state !== undefined && state.session.status !== 'over') {
        const env: Env = { storage: new MemoryStorage() };
        actual += render(endOfInput(state, env).events, { echo: true });
      }
      expect(actual, `${name}: output equals ${name}.chk`).toBe(readUpstream(`${name}.chk`));
    });
  }
});

describe('430-point walkthrough with the AI parser installed', () => {
  const logText = readUpstream('win430.log');
  const options = parseOptions(logText);
  const lines = splitLog(logText);

  it('is the harness log in its own mode (sanity)', () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  for (const mode of ['1976', 'haunted'] as const) {
    it(`${mode} mode: identical to the run without it, zero fetch calls for classic commands, score 430`, () => {
      // 1976 mode runs the log oldstyle; the walkthrough log itself is not oldstyle,
      // so in 1976 mode only the with/without comparison and the isolation hold.
      const plain = runController({ mode, lines, withAi: false });
      const withAi = runController({
        mode,
        lines,
        withAi: true,
        fetchScript: [{ kind: 'throw' }],
      });
      expect(withAi.original).toBe(plain.original);
      expect(withAi.transcript).toBe(plain.transcript);
      expect(withAi.errors).toBe(0);
      if (mode === '1976') expect(withAi.fetchCalls).toBe(0);
      if (mode === 'haunted' && !options.oldstyle) {
        // Byte-identical to the engine run of the upstream log.
        expect(withAi.original).toBe(render(replayLog('win430').events, { echo: false }));
        expect(withAi.fetchCalls).toBe(0);
        const last = withAi.gameOvers[withAi.gameOvers.length - 1];
        expect(withAi.phase).toBe('over');
        expect(last?.score).toBe(430);
      }
    });
  }
});

describe('Haunted mode: classic commands with an always-failing fetch', () => {
  it('gives the same original text as the run without a resolver', () => {
    const lines = splitLog(readUpstream('win430.log'));
    const plain = runController({ mode: 'haunted', lines, withAi: false });
    const failing = runController({
      mode: 'haunted',
      lines,
      withAi: true,
      fetchScript: [{ kind: 'throw' }],
    });
    expect(failing.original).toBe(plain.original);
    expect(failing.errors).toBe(0);
  });
});
