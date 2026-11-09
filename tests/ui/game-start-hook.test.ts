// ai-parser Requirement 1.2: the controller reports the running game's mode on every game start,
// and the AI parser chunk loads only for a Haunted game (once, never in 1976 mode).

import { describe, expect, it } from 'vitest';
import { createHauntedStartLoader } from '../../src/ai-loader';
import type { AiParserModule } from '../../src/ai-loader';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { Mode } from '../../src/ui/types';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

function make(kv: MemoryKeyValueStore, onGameStart: (m: Mode) => void) {
  const log = new RecordingLogger();
  const controller = new GameController({
    kv,
    clock: new FakeClock(1),
    motion: new FakeMotion(false),
    view: new FakeTerminal(),
    hooks: new ExtensionHooks(log),
    log,
    onGameStart,
  });
  return { controller, log };
}

function kvWith(mode: Mode): MemoryKeyValueStore {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode, speed: 'instant', crt: true }));
  return kv;
}

function boot(c: GameController): void {
  c.startBoot();
  c.tick(0);
  c.skip();
  c.tick(0);
}

describe('GameController onGameStart', () => {
  it('reports haunted for a haunted boot-time game and for New Game', () => {
    const calls: Mode[] = [];
    const { controller } = make(kvWith('haunted'), (m) => calls.push(m));
    boot(controller);
    expect(calls).toEqual(['haunted']);
    controller.requestNewGame();
    expect(calls).toEqual(['haunted', 'haunted']);
  });

  it('reports 1976 for a 1976 game and never haunted', () => {
    const calls: Mode[] = [];
    const { controller } = make(kvWith('1976'), (m) => calls.push(m));
    boot(controller);
    controller.requestNewGame();
    expect(calls).toEqual(['1976', '1976']);
  });

  it('a mode switch applies to the next new game only', () => {
    const calls: Mode[] = [];
    const { controller } = make(kvWith('1976'), (m) => calls.push(m));
    boot(controller);
    controller.setMode('haunted');
    expect(calls).toEqual(['1976']);
    controller.requestNewGame();
    expect(calls).toEqual(['1976', 'haunted']);
  });

  it('on autosave restore reports the restored game mode, not the selected setting', () => {
    const kv = kvWith('haunted');
    const first = make(kv, () => {});
    boot(first.controller);
    first.controller.submit('in');
    first.controller.tick(0);
    // Reload with the opposite setting selected.
    kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
    const calls: Mode[] = [];
    const second = make(kv, (m) => calls.push(m));
    boot(second.controller);
    expect(second.controller.gameMode).toBe('haunted');
    expect(calls).toEqual(['haunted']);
  });
});

describe('createHauntedStartLoader', () => {
  function harness(mode: Mode) {
    let loads = 0;
    const load = (): Promise<AiParserModule> => {
      loads++;
      return Promise.reject(new Error('no network in tests'));
    };
    const kv = kvWith(mode);
    let ctl: GameController | undefined;
    const log = new RecordingLogger();
    const hook = createHauntedStartLoader(() => ctl, log, load);
    const made = make(kv, hook);
    ctl = made.controller;
    return { ctl, hook, loads: () => loads, log };
  }

  it('does not load for a 1976 game', () => {
    const h = harness('1976');
    boot(h.ctl);
    h.ctl.requestNewGame();
    expect(h.loads()).toBe(0);
  });

  it('loads exactly once across haunted game starts, and logs a failure only', async () => {
    const h = harness('haunted');
    boot(h.ctl);
    h.ctl.requestNewGame();
    h.hook('haunted');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.loads()).toBe(1);
    expect(h.log.entries.length).toBe(1);
  });

  it('loads on the next haunted game after switching from 1976', () => {
    const h = harness('1976');
    boot(h.ctl);
    expect(h.loads()).toBe(0);
    h.ctl.setMode('haunted');
    h.ctl.requestNewGame();
    expect(h.loads()).toBe(1);
  });
});
