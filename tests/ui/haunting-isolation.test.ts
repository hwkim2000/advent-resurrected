// Feature: haunting, task 8.2: 1976 isolation with the real haunting loader installed.
// Real GameController + real createHauntingLoader on the game-start path; the chunk loaders
// are counting spies. In 1976 mode no haunt/effects module loads, no provider, observer,
// listener, transformer or gate is invoked, and the transcript equals a run without the loader.
// Requirement: 7.

import { describe, expect, it } from 'vitest';
import { createGameStartFanOut } from '../../src/game-start-fanout';
import { createHauntingLoader } from '../../src/haunting-loader';
import type { HauntEffectsModule, HauntingModule } from '../../src/haunting-loader';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { Mode } from '../../src/ui/types';
import { HARNESS_DEFAULT_SEED, readUpstream, splitLog } from '../replay-harness';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from './support/fakes';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface Run {
  original: string;
  all: string;
  loads: number;
  hookCalls: number;
  errors: number;
}

async function run(mode: Mode, lines: readonly string[], withLoader: boolean): Promise<Run> {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode, speed: 'instant', crt: true }));
  const view = new FakeTerminal();
  const log = new RecordingLogger();
  const hooks = new ExtensionHooks(log);
  let hookCalls = 0;
  let loads = 0;
  hooks.addNarratorLineProvider(() => {
    hookCalls += 1;
    return [];
  });
  hooks.addEventObserver(() => {
    hookCalls += 1;
  });
  hooks.addOutputListener(() => {
    hookCalls += 1;
  });

  let controller: GameController | undefined;
  const handlers: ((m: Mode) => void)[] = [];
  if (withLoader) {
    handlers.push(
      createHauntingLoader({
        getHost: () => {
          const c = controller;
          if (c === undefined) return undefined;
          return {
            hooks,
            motion: new FakeMotion(false),
            get engineState() {
              return c.engineState;
            },
          };
        },
        log,
        seed: 1,
        loadHaunting: async (): Promise<HauntingModule> => {
          loads += 1;
          return await import('../../src/haunt/haunting');
        },
        loadEffects: async (): Promise<HauntEffectsModule> => {
          loads += 1;
          return await import('../../src/ui/dom/haunt-effects');
        },
      }),
    );
  }
  controller = new GameController({
    kv,
    clock: new FakeClock(HARNESS_DEFAULT_SEED),
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    onGameStart: createGameStartFanOut(handlers, log),
  });
  controller.startBoot();
  controller.tick(0);
  controller.skip();
  for (const line of lines) {
    if (controller.phase !== 'ready') break;
    controller.submit(line);
    controller.tick(0);
  }
  controller.tick(0);
  await flush();
  return {
    original: view.textOfKind('original'),
    all: view.blocks.map((b) => `${b.kind}:${b.revealed}`).join('\n'),
    loads,
    hookCalls,
    errors: log.entries.length,
  };
}

const SCRIPT = ['look', 'in', 'take keys', 'xyzzy', 'plugh', 'what is that?', 'yes', 'quit', 'yes'];

describe('1976 mode with the real haunting loader', () => {
  it('never loads haunt or effects modules and never invokes a hook', async () => {
    const r = await run('1976', SCRIPT, true);
    expect(r.loads).toBe(0);
    expect(r.hookCalls).toBe(0);
    expect(r.errors).toBe(0);
  });

  it('has a transcript identical to a run without the loader (short script)', async () => {
    const plain = await run('1976', SCRIPT, false);
    const withLoader = await run('1976', SCRIPT, true);
    expect(withLoader.original).toBe(plain.original);
    expect(withLoader.all).toBe(plain.all);
    expect(withLoader.errors).toBe(plain.errors);
  });

  it('has a transcript identical to a run without the loader (win430 log)', async () => {
    const lines = splitLog(readUpstream('win430.log'));
    const plain = await run('1976', lines, false);
    const withLoader = await run('1976', lines, true);
    expect(withLoader.loads).toBe(0);
    expect(withLoader.hookCalls).toBe(0);
    expect(withLoader.original).toBe(plain.original);
    expect(withLoader.all).toBe(plain.all);
  });

  it('control: Haunted mode does load the chunks through the same path', async () => {
    const r = await run('haunted', ['look'], true);
    expect(r.loads).toBe(2);
  });
});
