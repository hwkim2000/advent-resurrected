// Haunting task 4.4: the lazy loader policy.
import { describe, expect, it, vi } from 'vitest';
import { createHauntingLoader } from '../../src/haunting-loader';
import type {
  HauntEffectsHandle,
  HauntEffectsModule,
  HauntingHandle,
  HauntingModule,
} from '../../src/haunting-loader';
import type { Mode } from '../../src/ui/types';
import { FakeMotion, RecordingLogger, makeController } from '../ui/support/fakes';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function rig(opts: { failHaunting?: boolean } = {}) {
  const log = new RecordingLogger();
  const made = makeController({ mode: 'haunted' });
  const calls = { loadHaunting: 0, loadEffects: 0, created: 0, gameStarts: [] as unknown[], disposed: 0, resets: 0 };
  const effects: HauntEffectsHandle = {
    setDim: () => {},
    flashGlitch: () => {},
    reincarnate: () => {},
    reset: () => {
      calls.resets += 1;
    },
  };
  const handle: HauntingHandle = {
    gameStart: (s) => {
      calls.gameStarts.push(s);
    },
    dispose: () => {
      calls.disposed += 1;
    },
  };
  const loader = createHauntingLoader({
    getHost: () => ({
      hooks: made.hooks,
      motion: new FakeMotion(false),
      get engineState() {
        return made.controller.engineState;
      },
    }),
    log,
    seed: 5,
    loadHaunting: async (): Promise<HauntingModule> => {
      calls.loadHaunting += 1;
      if (opts.failHaunting) throw new Error('chunk 404');
      return {
        createHaunting: () => {
          calls.created += 1;
          return handle;
        },
      };
    },
    loadEffects: async (): Promise<HauntEffectsModule> => {
      calls.loadEffects += 1;
      return { createHauntEffects: () => effects };
    },
  });
  return { loader, calls, log, made };
}

describe('haunting loader', () => {
  it('never loads a chunk for a 1976 game', async () => {
    const { loader, calls } = rig();
    loader('1976');
    await flush();
    expect(calls.loadHaunting + calls.loadEffects + calls.created).toBe(0);
  });

  it('never loads a chunk when the controller starts a 1976 game', async () => {
    const log = new RecordingLogger();
    let loads = 0;
    const loader = createHauntingLoader({
      getHost: () => undefined,
      log,
      seed: 1,
      loadHaunting: async () => {
        loads += 1;
        throw new Error('should not load');
      },
      loadEffects: async () => {
        loads += 1;
        throw new Error('should not load');
      },
    });
    makeController({ mode: '1976', onGameStart: loader });
    await flush();
    expect(loads).toBe(0);
    expect(log.entries).toEqual([]);
  });

  it('loads both chunks once and calls gameStart with the engine state on every Haunted start', async () => {
    const { loader, calls, made } = rig();
    loader('haunted');
    loader('haunted');
    await flush();
    expect(calls.loadHaunting).toBe(1);
    expect(calls.loadEffects).toBe(1);
    expect(calls.created).toBe(1);
    expect(calls.gameStarts).toEqual([made.controller.engineState]);
    loader('haunted');
    expect(calls.loadHaunting).toBe(1);
    expect(calls.gameStarts.length).toBe(2);
    expect(calls.created).toBe(1);
  });

  it('disposes and resets the effects on a switch to 1976, then recreates on the next Haunted start', async () => {
    const { loader, calls } = rig();
    loader('haunted');
    await flush();
    loader('1976');
    expect(calls.disposed).toBe(1);
    expect(calls.resets).toBe(1);
    loader('haunted');
    expect(calls.created).toBe(2);
    expect(calls.loadHaunting).toBe(1);
  });

  it('does not start haunting if the mode became 1976 while loading', async () => {
    const { loader, calls } = rig();
    loader('haunted');
    loader('1976');
    await flush();
    expect(calls.created).toBe(0);
    expect(calls.gameStarts).toEqual([]);
  });

  it('treats a load failure as non-fatal: logged, game keeps running, a later start retries', async () => {
    const { loader, calls, log, made } = rig({ failHaunting: true });
    expect(() => loader('haunted')).not.toThrow();
    await flush();
    expect(log.entries.some((e) => e.message === 'haunting failed to load')).toBe(true);
    expect(calls.created).toBe(0);
    made.controller.submit('no');
    made.controller.tick(0);
    expect(made.controller.phase).toBe('ready');
    loader('haunted');
    await flush();
    expect(calls.loadHaunting).toBe(2);
  });

  it('logs and survives a missing host', async () => {
    const log = new RecordingLogger();
    const loader = createHauntingLoader({
      getHost: () => undefined,
      log,
      seed: 1,
      loadHaunting: async () => ({ createHaunting: vi.fn() }),
      loadEffects: async () => ({ createHauntEffects: vi.fn() }),
    });
    loader('haunted' as Mode);
    await flush();
    expect(log.entries.map((e) => e.message)).toEqual(['haunting failed to start']);
  });
});
