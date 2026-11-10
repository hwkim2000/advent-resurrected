// Feature: voice-input, task 13.1: 1976 isolation with the voice layer installed.
// Real GameController + real createVoiceStartLoader + real fan-out, with counting fakes
// for the chunk loaders, the recognition constructors, navigator.permissions.query and
// getUserMedia, and the real markup of index.html behind the real Mic_Button DOM module:
//  - a 1976 game (and a restored 1976 autosave) makes zero calls, loads no chunk, keeps
//    the Mic_Button and Voice_Disclosure hidden, leaves Voice_Status and the live region
//    empty and registers no Input_Gate;
//  - with the layer loaded, Haunted -> 1976 aborts a session without a line, hides and
//    clears everything and removes the gate before the first prompt;
//  - a 1976 start during a pending load stays suspended;
//  - src/main.ts reaches voice and haunt only through import();
//  - every upstream log replayed in 1976 mode with the loader installed is byte-identical
//    to the run without it (pattern of tests/ui/ai-isolation.test.ts).
// Requirements: 1.1, 1.2, 1.4, 1.6, 1.10, 2.10, 8.11, 12.8, 18.11.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endOfInput, render } from '../../src/engine/index';
import type { Env } from '../../src/engine/index';
import { createGameStartFanOut } from '../../src/game-start-fanout';
import { createVoiceStartLoader } from '../../src/voice-loader';
import type { HauntModule, VoiceLoaderHost, VoiceModule, VoiceStartLoader } from '../../src/voice-loader';
import { clearAutosave } from '../../src/ui/autosave';
import { installMicButton } from '../../src/ui/dom/mic-button';
import type { MicElements, MicHandle } from '../../src/ui/dom/mic-button';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { FILE_PREFIX, SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { Mode } from '../../src/ui/types';
import type { VoiceLayer } from '../../src/ui/voice-port';
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
  splitLog,
} from '../replay-harness';
import { FakePermissions } from '../voice/support/fake-permissions';
import {
  FakeSpeechRecognition,
  installFakeRecognition,
  uninstallFakeRecognition,
} from '../voice/support/fake-recognition';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

// ---- counting fakes for the browser surface the voice layer may touch ----

interface Counts {
  voiceLoads: number;
  hauntLoads: number;
  getUserMedia: number;
  gateAdds: number;
  gateDisposes: number;
}

let permissions: FakePermissions;
let counts: Counts;
const restorers: Array<() => void> = [];

function overrideProperty(target: object, name: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (own !== undefined) Object.defineProperty(target, name, own);
    else delete (target as Record<string, unknown>)[name];
  });
}

function installCounters(): void {
  counts = { voiceLoads: 0, hauntLoads: 0, getUserMedia: 0, gateAdds: 0, gateDisposes: 0 };
  installFakeRecognition();
  permissions = new FakePermissions('prompt');
  overrideProperty(navigator, 'permissions', permissions);
  overrideProperty(navigator.mediaDevices, 'getUserMedia', () => {
    counts.getUserMedia += 1;
    throw new Error('getUserMedia must not be called');
  });
  overrideProperty(globalThis, 'isSecureContext', true);
}

// ---- the real markup of index.html behind the real Mic_Button module ----

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
  .replace(/<link\b[^>]*>/g, '')
  .replace(/<script\b[^>]*><\/script>/g, '');

interface Dom {
  button: HTMLButtonElement;
  status: HTMLElement;
  disclosure: HTMLElement;
  unavailable: HTMLElement;
  live: HTMLElement;
  input: HTMLInputElement;
}

let domWindow: Window | undefined;

function mountDom(): Dom {
  domWindow?.close();
  const win = new Window();
  domWindow = win;
  const document = win.document as unknown as Document;
  const parsed = new win.DOMParser().parseFromString(INDEX_HTML, 'text/html') as unknown as Document;
  const part = ['voice-bar', 'voice-live']
    .map((id) => parsed.getElementById(id)?.outerHTML ?? '')
    .join('');
  document.body.innerHTML = part + '<input id="cmd" type="text">';
  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  return {
    button: byId<HTMLButtonElement>('mic'),
    status: byId('voice-status'),
    disclosure: byId('mic-disclosure'),
    unavailable: byId('mic-unavailable'),
    live: byId('voice-live'),
    input: byId<HTMLInputElement>('cmd'),
  };
}

// ---- the stack under test ----

type LoadMode = 'forbidden' | 'real' | 'deferred';

interface Stack {
  controller: GameController;
  view: FakeTerminal;
  log: RecordingLogger;
  loader: VoiceStartLoader;
  dom: Dom;
  mic: MicHandle;
  kv: MemoryKeyValueStore;
  submits: Array<{ line: string; origin: string }>;
  otherStarts: Mode[];
  layer(): VoiceLayer | undefined;
  release(): void;
}

const mics: MicHandle[] = [];

function makeStack(o: {
  selected: Mode;
  loads: LoadMode;
  kv?: MemoryKeyValueStore;
  afterLoader?: (mode: Mode) => void;
}): Stack {
  const kv = o.kv ?? new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode: o.selected, speed: 'instant', crt: true }));
  const dom = mountDom();
  const log = new RecordingLogger();
  const view = new FakeTerminal();
  const hooks = new ExtensionHooks(log);
  const submits: Array<{ line: string; origin: string }> = [];
  const otherStarts: Mode[] = [];
  let created: VoiceLayer | undefined;
  let controller: GameController | undefined;

  const mic = installMicButton({
    els: { ...dom } as unknown as MicElements,
    defer: () => {},
  });
  mics.push(mic);

  let releaseFn: () => void = () => {};
  const released = new Promise<void>((res) => {
    releaseFn = res;
  });

  const host: VoiceLoaderHost = {
    submit: (line, origin) => {
      submits.push({ line, origin });
      controller?.submit(line, origin);
    },
    get promptKind() {
      return controller?.promptKind;
    },
    get phase() {
      return controller?.phase as VoiceLoaderHost['phase'];
    },
    get gameMode() {
      return controller?.gameMode;
    },
    log,
    addInputGate: (gate) => {
      counts.gateAdds += 1;
      const dispose = hooks.addInputGate(gate);
      return () => {
        counts.gateDisposes += 1;
        dispose();
      };
    },
  };

  const loader = createVoiceStartLoader({
    getHost: () => host,
    log,
    loadVoice: (): Promise<VoiceModule> => {
      counts.voiceLoads += 1;
      if (o.loads === 'forbidden') return Promise.reject(new Error('voice chunk must not load'));
      const load = (): Promise<VoiceModule> => import('../../src/voice/browser');
      return o.loads === 'deferred' ? released.then(load) : load();
    },
    loadHaunt: (): Promise<HauntModule> => {
      counts.hauntLoads += 1;
      if (o.loads === 'forbidden') return Promise.reject(new Error('haunt chunk must not load'));
      const load = (): Promise<HauntModule> => import('../../src/haunt/spoken-word-rule');
      return o.loads === 'deferred' ? released.then(load) : load();
    },
    onLayer: (layer) => {
      created = layer;
      mic.attach(layer.port);
    },
  });

  // As in src/main.ts: one fan-out, an independent handler next to the voice loader.
  const onGameStart = createGameStartFanOut(
    [
      (m) => otherStarts.push(m),
      loader.onGameStart,
      (m) => o.afterLoader?.(m),
    ],
    log,
  );
  controller = new GameController({
    kv,
    clock: new FakeClock(HARNESS_DEFAULT_SEED),
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    onGameStart,
  });

  return {
    controller,
    view,
    log,
    loader,
    dom,
    mic,
    kv,
    submits,
    otherStarts,
    layer: () => created,
    release: () => releaseFn(),
  };
}

function boot(c: GameController): void {
  c.startBoot();
  c.tick(0);
  c.skip();
  c.tick(0);
}

function typedLine(s: Stack, line: string): string {
  const before = s.view.textOfKind('original');
  s.controller.submit(line);
  s.controller.tick(0);
  return s.view.textOfKind('original').slice(before.length);
}

/** The text a typed line adds in a plain 1976 game with no voice code at all. */
function baselineDelta(line: string): string {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const c = new GameController({
    kv,
    clock: new FakeClock(HARNESS_DEFAULT_SEED),
    motion: new FakeMotion(false),
    view,
    hooks: new ExtensionHooks(log),
    log,
  });
  boot(c);
  const before = view.textOfKind('original');
  c.submit(line);
  c.tick(0);
  return view.textOfKind('original').slice(before.length);
}

function expectVoiceInert(s: Stack): void {
  expect(counts.voiceLoads, 'voice chunk loads').toBe(0);
  expect(counts.hauntLoads, 'haunt chunk loads').toBe(0);
  expect(FakeSpeechRecognition.constructions, 'recognition constructions').toBe(0);
  expect(FakeSpeechRecognition.startCalls, 'recognition start calls').toBe(0);
  expect(permissions.queries.length, 'permissions.query calls').toBe(0);
  expect(counts.getUserMedia, 'getUserMedia calls').toBe(0);
  expect(counts.gateAdds, 'input gates registered').toBe(0);
  expect(s.layer()).toBeUndefined();
  expect(s.submits).toEqual([]);
  expect(s.dom.button.hidden).toBe(true);
  expect(s.dom.button.hasAttribute('hidden')).toBe(true);
  expect(s.dom.disclosure.hidden).toBe(true);
  expect(s.dom.disclosure.hasAttribute('hidden')).toBe(true);
  expect(s.dom.status.textContent).toBe('');
  expect(s.dom.live.textContent).toBe('');
  expect(s.log.entries).toEqual([]);
}

beforeEach(() => {
  installCounters();
});

afterEach(() => {
  for (const m of mics.splice(0)) m.dispose();
  uninstallFakeRecognition();
  for (const r of restorers.splice(0).reverse()) r();
  domWindow?.close();
  domWindow = undefined;
});

describe('1976 mode: the voice layer is never touched', () => {
  it('the source markup starts hidden and empty in every mode', () => {
    const dom = mountDom();
    expect(dom.button.hasAttribute('hidden')).toBe(true);
    expect(dom.disclosure.hasAttribute('hidden')).toBe(true);
    expect(dom.status.textContent).toBe('');
    expect(dom.live.textContent).toBe('');
    expect(dom.live.hasAttribute('hidden')).toBe(false);
  });

  it('nothing loads at startup, before any game starts', () => {
    const s = makeStack({ selected: 'haunted', loads: 'forbidden' });
    expectVoiceInert(s);
    expect(s.otherStarts).toEqual([]);
  });

  it('a 1976 game and its new games make zero calls; a typed XYZZY reaches the engine unchanged', () => {
    const s = makeStack({ selected: '1976', loads: 'forbidden' });
    boot(s.controller);
    expect(s.controller.gameMode).toBe('1976');
    expect(s.otherStarts).toEqual(['1976']);
    expect(typedLine(s, 'xyzzy')).toBe(baselineDelta('xyzzy'));
    s.loader.syncHost();
    s.controller.requestNewGame();
    s.controller.requestNewGame();
    s.loader.syncHost();
    // The independent handler of the fan-out still ran for every start.
    expect(s.otherStarts).toEqual(['1976', '1976', '1976']);
    expectVoiceInert(s);
    // No narrator line of any kind was added.
    expect(s.view.textOfKind('narrator')).toBe('');
  });

  it('a restored 1976 autosave loads nothing, even with Haunted selected', () => {
    const first = makeStack({ selected: '1976', loads: 'forbidden' });
    boot(first.controller);
    first.controller.submit('in');
    first.controller.tick(0);
    expectVoiceInert(first);

    const second = makeStack({ selected: 'haunted', loads: 'forbidden', kv: first.kv });
    boot(second.controller);
    expect(second.controller.gameMode).toBe('1976');
    expect(typedLine(second, 'xyzzy')).toBeTypeOf('string');
    expectVoiceInert(second);
  });
});

describe('Haunted to 1976 with the layer loaded', () => {
  it('aborts the session without a line and hides and clears everything before the first prompt', async () => {
    interface Snapshot {
      buttonHidden: boolean;
      disclosureHidden: boolean;
      status: string | null;
      live: string | null;
      gateDisposes: number;
      submits: number;
    }
    let atStart: Snapshot | undefined;
    // eslint-disable-next-line prefer-const
    let stack!: Stack;
    stack = makeStack({
      selected: 'haunted',
      loads: 'real',
      afterLoader: (m) => {
        if (m !== '1976') return;
        atStart = {
          buttonHidden: stack.dom.button.hasAttribute('hidden'),
          disclosureHidden: stack.dom.disclosure.hasAttribute('hidden'),
          status: stack.dom.status.textContent,
          live: stack.dom.live.textContent,
          gateDisposes: counts.gateDisposes,
          submits: stack.submits.length,
        };
      },
    });
    boot(stack.controller);
    await vi.waitFor(() => expect(stack.layer()).toBeDefined());
    stack.loader.syncHost();
    const layer = stack.layer()!;

    // Haunted: usable, shown, gate registered, no microphone request yet.
    expect(layer.usable).toBe(true);
    expect(stack.dom.button.hidden).toBe(false);
    expect(stack.dom.disclosure.hidden).toBe(false);
    expect(counts.gateAdds).toBe(1);
    expect(counts.getUserMedia).toBe(0);

    // A running session with visible status text.
    layer.port.dispatch({ type: 'button-activate', via: 'touch' });
    const rec = FakeSpeechRecognition.last!;
    expect(rec.calls).toContain('start');
    rec.emitStart();
    expect(layer.listening).toBe(true);
    expect(stack.dom.status.textContent).not.toBe('');
    const before = {
      constructions: FakeSpeechRecognition.constructions,
      starts: FakeSpeechRecognition.startCalls,
      queries: permissions.queries.length,
    };

    stack.controller.setMode('1976');
    stack.controller.requestNewGame();

    // Seen inside the start notification, i.e. before the first prompt of the 1976 game.
    expect(atStart).toEqual({
      buttonHidden: true,
      disclosureHidden: true,
      status: '',
      live: '',
      gateDisposes: 1,
      submits: 0,
    });
    expect(stack.controller.gameMode).toBe('1976');
    expect(rec.calls).toContain('abort');
    expect(layer.listening).toBe(false);
    expect(layer.usable).toBe(false);
    expect(layer.port.getView().availability).toBe('Suspended');

    // A late result and end after the abort submit nothing; a press starts nothing.
    rec.emitResult([{ isFinal: true, alternatives: ['look'] }]);
    rec.emitEnd();
    layer.port.dispatch({ type: 'button-activate', via: 'keyboard' });
    layer.port.dispatch({ type: 'altm-down', repeat: false });
    layer.port.dispatch({ type: 'altm-up' });
    stack.loader.syncHost();

    expect(stack.submits).toEqual([]);
    expect(FakeSpeechRecognition.constructions).toBe(before.constructions);
    expect(FakeSpeechRecognition.startCalls).toBe(before.starts);
    expect(permissions.queries.length).toBe(before.queries);
    expect(counts.getUserMedia).toBe(0);
    expect(counts.voiceLoads).toBe(1);
    expect(counts.gateAdds).toBe(1);
    expect(stack.dom.button.hidden).toBe(true);
    expect(stack.dom.disclosure.hidden).toBe(true);
    expect(stack.dom.status.textContent).toBe('');
    expect(stack.dom.live.textContent).toBe('');
    expect(stack.log.entries).toEqual([]);

    // Typing keeps working and the typed XYZZY is the plain engine answer.
    expect(typedLine(stack, 'xyzzy')).toBe(baselineDelta('xyzzy'));
    expect(stack.view.textOfKind('narrator')).toBe('');
  });

  it('a 1976 start during a pending load leaves the layer suspended', async () => {
    const s = makeStack({ selected: 'haunted', loads: 'deferred' });
    boot(s.controller);
    expect(counts.voiceLoads).toBe(1);
    // Typing works while the import is pending.
    expect(typedLine(s, 'look').length).toBeGreaterThan(0);

    s.controller.setMode('1976');
    s.controller.requestNewGame();
    s.release();
    await vi.waitFor(() => expect(s.layer()).toBeDefined());
    s.loader.syncHost();

    const layer = s.layer()!;
    expect(layer.usable).toBe(false);
    expect(layer.port.getView().availability).toBe('Suspended');
    expect(FakeSpeechRecognition.constructions).toBe(0);
    expect(FakeSpeechRecognition.startCalls).toBe(0);
    expect(permissions.queries.length).toBe(0);
    expect(counts.getUserMedia).toBe(0);
    expect(counts.gateAdds).toBe(0);
    expect(s.dom.button.hidden).toBe(true);
    expect(s.dom.disclosure.hidden).toBe(true);
    expect(s.dom.status.textContent).toBe('');
    expect(s.dom.live.textContent).toBe('');
    expect(s.submits).toEqual([]);
    expect(s.log.entries).toEqual([]);

    // Presses on the suspended layer start nothing.
    layer.port.dispatch({ type: 'button-activate', via: 'touch' });
    layer.port.dispatch({ type: 'altm-down', repeat: false });
    expect(FakeSpeechRecognition.constructions).toBe(0);
    expect(typedLine(s, 'xyzzy')).toBe(baselineDelta('xyzzy'));
  });
});

describe('src/main.ts and the loaders reach voice and haunt only through import()', () => {
  const read = (rel: string): string =>
    readFileSync(resolve(__dirname, '../../src', rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const TARGET = /(^|\/)(voice|haunt)(\/|$)/;

  function staticSpecs(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)) out.push(m[1]!);
    for (const m of src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]!);
    return out;
  }
  function dynamicSpecs(src: string): string[] {
    return [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
  }

  it('main.ts has no static import of voice or haunt and three dynamic ones', () => {
    const src = read('main.ts');
    expect(staticSpecs(src).filter((s) => TARGET.test(s))).toEqual([]);
    const dyn = dynamicSpecs(src);
    expect(dyn).toContain('./voice/browser');
    expect(dyn).toContain('./haunt/spoken-word-rule');
    expect(dyn.filter((s) => TARGET.test(s)).sort()).toEqual([
      './haunt/haunting', // haunting spec task 4.3: narrator, dim, glitch
      './haunt/spoken-word-rule',
      './voice/browser',
    ]);
    expect(src).not.toMatch(/\brequire\(|import\.meta\.glob/);
    // The loader modules are the only static path, and they name no voice or haunt module.
    expect(staticSpecs(src)).toEqual(expect.arrayContaining(['./voice-loader', './game-start-fanout']));
  });

  it('voice-loader.ts and game-start-fanout.ts name no voice or haunt module in any form', () => {
    for (const file of ['voice-loader.ts', 'game-start-fanout.ts']) {
      const src = read(file);
      expect([...staticSpecs(src), ...dynamicSpecs(src)].filter((s) => TARGET.test(s)), file).toEqual([]);
    }
  });
});

// ---- upstream replay in 1976 mode with the loader installed (ai-isolation pattern) ----

interface Run {
  original: string;
  transcript: string;
  errors: number;
  controller: GameController;
}

function newKv(fixtures: Readonly<Record<string, string>> = {}): MemoryKeyValueStore {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
  for (const [name, data] of Object.entries(fixtures)) kv.set(FILE_PREFIX + name, data);
  return kv;
}

function runLines(lines: readonly string[], kv: MemoryKeyValueStore, withVoice: boolean): Run {
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const hooks = new ExtensionHooks(log);
  let controller: GameController | undefined;
  let onGameStart: ((mode: Mode) => void) | undefined;
  if (withVoice) {
    const host: VoiceLoaderHost = {
      submit: (line, origin) => controller?.submit(line, origin),
      get promptKind() {
        return controller?.promptKind;
      },
      get phase() {
        return controller?.phase as VoiceLoaderHost['phase'];
      },
      get gameMode() {
        return controller?.gameMode;
      },
      log,
      addInputGate: (gate) => {
        counts.gateAdds += 1;
        return hooks.addInputGate(gate);
      },
    };
    const loader = createVoiceStartLoader({
      getHost: () => host,
      log,
      loadVoice: () => {
        counts.voiceLoads += 1;
        return Promise.reject(new Error('voice chunk must not load in 1976 mode'));
      },
      loadHaunt: () => {
        counts.hauntLoads += 1;
        return Promise.reject(new Error('haunt chunk must not load in 1976 mode'));
      },
    });
    onGameStart = createGameStartFanOut([loader.onGameStart], log);
  }
  controller = new GameController({
    kv,
    clock: new FakeClock(HARNESS_DEFAULT_SEED),
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    ...(onGameStart ? { onGameStart } : {}),
  });

  controller.startBoot();
  controller.tick(0);
  controller.skip();

  const submitted: string[] = [];
  for (const line of lines) {
    if (controller.phase !== 'ready') break;
    controller.submit(line);
    controller.tick(0);
    submitted.push(line);
  }
  controller.tick(0);

  let transcript = '';
  let inputIndex = 0;
  const blockText = new Map(view.blocks.map((b) => [b.id, b]));
  for (const call of view.calls) {
    if (call.method === 'appendInstant') {
      for (const l of call.lines) {
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
    errors: log.entries.length,
    controller,
  };
}

function replayOne(name: string, withVoice: boolean): Run {
  const kv = newKv(STATIC_FIXTURES);
  const deps: string[] = [];
  const collect = (n: string): void => {
    for (const d of FIXTURE_DEPENDENCIES[n] ?? []) {
      if (deps.includes(d)) continue;
      collect(d);
      deps.push(d);
    }
  };
  collect(name);
  for (const d of deps) {
    runLines(splitLog(readUpstream(`${d}.log`)), kv, withVoice);
    clearAutosave(kv);
  }
  return runLines(splitLog(readUpstream(`${name}.log`)), kv, withVoice);
}

describe('1976 mode: upstream logs with the voice loader installed', () => {
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
      const plain = replayOne(name, false);
      const withVoice = replayOne(name, true);

      expect(counts.voiceLoads, `${name}: voice chunk loads`).toBe(0);
      expect(counts.hauntLoads, `${name}: haunt chunk loads`).toBe(0);
      expect(counts.gateAdds, `${name}: input gates`).toBe(0);
      expect(FakeSpeechRecognition.constructions).toBe(0);
      expect(permissions.queries.length).toBe(0);
      expect(counts.getUserMedia).toBe(0);

      expect(withVoice.original, `${name}: original text with the loader`).toBe(plain.original);
      expect(withVoice.transcript).toBe(plain.transcript);
      expect(withVoice.errors).toBe(plain.errors);

      const options = parseOptions(readUpstream(`${name}.log`));
      if (!options.oldstyle || options.restoreFile !== undefined) return;
      const chk = checkLog(name);
      if (!chk.pass) expect.fail(chk.message);
      let actual = withVoice.transcript;
      const state = withVoice.controller.engineState;
      if (state !== undefined && state.session.status !== 'over') {
        const env: Env = { storage: new MemoryStorage() };
        actual += render(endOfInput(state, env).events, { echo: true });
      }
      expect(actual, `${name}: output equals ${name}.chk`).toBe(readUpstream(`${name}.chk`));
    });
  }
});
