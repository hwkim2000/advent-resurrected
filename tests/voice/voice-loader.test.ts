// voice-input Requirements 1.3, 1.6-1.10, 13.8, 18.11: lazy loading policy of src/voice-loader.ts
// with fake loaders (no network, no real voice layer).

import { describe, expect, it } from 'vitest';
import { createGameStartFanOut } from '../../src/game-start-fanout';
import { createVoiceStartLoader } from '../../src/voice-loader';
import type { HauntModule, VoiceLoaderHost, VoiceModule } from '../../src/voice-loader';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import type { InputGate } from '../../src/ui/extension-hooks';
import { GameController } from '../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../src/ui/save-store';
import { printSettings } from '../../src/ui/settings';
import type { Mode } from '../../src/ui/types';
import type { VoiceLayer } from '../../src/ui/voice-port';
import { FakeClock, FakeMotion, FakeTerminal, RecordingLogger } from '../ui/support/fakes';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function kvWith(mode: Mode): MemoryKeyValueStore {
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode, speed: 'instant', crt: true }));
  return kv;
}

type LoadBehavior = 'resolve' | 'pending' | 'reject';

function setup(mode: Mode, kv: MemoryKeyValueStore = kvWith(mode), behavior: LoadBehavior = 'resolve') {
  const log = new RecordingLogger();
  const view = new FakeTerminal();
  const hooks = new ExtensionHooks(log);
  const order: string[] = [];
  const layerCalls: Mode[] = [];
  let gatesAdded = 0;
  let gatesDisposed = 0;
  let voiceLoads = 0;
  let hauntLoads = 0;
  let layersCreated = 0;
  let mode_: LoadBehavior = behavior;

  const layer: VoiceLayer = {
    port: {
      getView: () => {
        throw new Error('unused');
      },
      onView: () => () => {},
      dispatch: () => ({ preventDefault: false }),
    },
    usable: true,
    listening: false,
    subscribe: () => () => {},
    gameStart: (m) => {
      layerCalls.push(m);
      order.push(`layer:${m}`);
    },
    syncHost: () => {},
  };
  const voiceModule: VoiceModule = {
    createBrowserVoiceLayer: () => {
      layersCreated++;
      return layer;
    },
  };
  const hauntModule: HauntModule = {
    createSpokenWordGate: (): InputGate => () => ({ kind: 'allow' }),
  };

  let controller: GameController | undefined;
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
      gatesAdded++;
      order.push('gate:add');
      const dispose = hooks.addInputGate(gate);
      return () => {
        gatesDisposed++;
        order.push('gate:dispose');
        dispose();
      };
    },
  };

  let pendingVoice = deferred<VoiceModule>();
  let pendingHaunt = deferred<HauntModule>();
  const loader = createVoiceStartLoader({
    getHost: () => host,
    log,
    loadVoice: () => {
      voiceLoads++;
      if (mode_ === 'resolve') return Promise.resolve(voiceModule);
      if (mode_ === 'reject') return Promise.reject(new Error('chunk 404'));
      pendingVoice = deferred<VoiceModule>();
      return pendingVoice.promise;
    },
    loadHaunt: () => {
      hauntLoads++;
      if (mode_ === 'resolve') return Promise.resolve(hauntModule);
      if (mode_ === 'reject') return Promise.resolve(hauntModule);
      pendingHaunt = deferred<HauntModule>();
      return pendingHaunt.promise;
    },
  });

  const fan = createGameStartFanOut([(m) => order.push(`start:${m}`), loader.onGameStart], log);
  controller = new GameController({
    kv,
    clock: new FakeClock(1),
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    onGameStart: fan,
  });

  return {
    controller,
    view,
    log,
    loader,
    order,
    layerCalls,
    setBehavior: (b: LoadBehavior) => {
      mode_ = b;
    },
    settlePending: () => {
      pendingVoice.resolve(voiceModule);
      pendingHaunt.resolve(hauntModule);
    },
    stats: () => ({ voiceLoads, hauntLoads, layersCreated, gatesAdded, gatesDisposed }),
  };
}

function boot(c: GameController): void {
  c.startBoot();
  c.tick(0);
  c.skip();
  c.tick(0);
}

describe('createVoiceStartLoader', () => {
  it('loads once on the first Haunted start and keeps the layer across later starts', async () => {
    const h = setup('haunted');
    boot(h.controller);
    await flush();
    expect(h.stats()).toMatchObject({ voiceLoads: 1, hauntLoads: 1, layersCreated: 1 });
    expect(h.layerCalls).toEqual(['haunted']);
    h.controller.requestNewGame();
    h.controller.requestNewGame();
    await flush();
    expect(h.stats()).toMatchObject({ voiceLoads: 1, hauntLoads: 1, layersCreated: 1 });
    expect(h.layerCalls).toEqual(['haunted', 'haunted', 'haunted']);
    expect(h.log.entries).toEqual([]);
  });

  it('never loads in 1976 mode, however many games start', async () => {
    const h = setup('1976');
    boot(h.controller);
    h.controller.requestNewGame();
    await flush();
    expect(h.stats()).toMatchObject({ voiceLoads: 0, hauntLoads: 0, layersCreated: 0, gatesAdded: 0 });
  });

  it('a mode change during a game triggers nothing; the next new game loads', async () => {
    const h = setup('1976');
    boot(h.controller);
    h.controller.setMode('haunted');
    await flush();
    expect(h.stats().voiceLoads).toBe(0);
    h.controller.requestNewGame();
    await flush();
    expect(h.stats()).toMatchObject({ voiceLoads: 1, layersCreated: 1, gatesAdded: 1 });
  });

  it('a restored 1976 game loads nothing; a restored Haunted game does', async () => {
    const kv = kvWith('haunted');
    const first = setup('haunted', kv);
    boot(first.controller);
    first.controller.submit('in');
    first.controller.tick(0);

    // Reload with the opposite setting selected: the restored Haunted game decides.
    kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
    const restoredHaunted = setup('1976', kv);
    boot(restoredHaunted.controller);
    await flush();
    expect(restoredHaunted.controller.gameMode).toBe('haunted');
    expect(restoredHaunted.stats().voiceLoads).toBe(1);

    const kv2 = kvWith('1976');
    const f2 = setup('1976', kv2);
    boot(f2.controller);
    f2.controller.submit('in');
    f2.controller.tick(0);
    kv2.set(SETTINGS_KEY, printSettings({ mode: 'haunted', speed: 'instant', crt: true }));
    const restored1976 = setup('haunted', kv2);
    boot(restored1976.controller);
    await flush();
    expect(restored1976.controller.gameMode).toBe('1976');
    expect(restored1976.stats().voiceLoads).toBe(0);
  });

  it('while the import never settles the first prompt shows and typed lines are answered', async () => {
    const h = setup('haunted', undefined, 'pending');
    boot(h.controller);
    await flush();
    expect(h.stats().voiceLoads).toBe(1);
    expect(h.stats().layersCreated).toBe(0);
    expect(h.view.prompt).toBeDefined();
    const before = h.view.blocks.length;
    h.controller.submit('in');
    h.controller.tick(0);
    expect(h.view.blocks.length).toBeGreaterThan(before);
    // A second Haunted start while loading does not start another load.
    h.controller.requestNewGame();
    await flush();
    expect(h.stats().voiceLoads).toBe(1);
    expect(h.log.entries).toEqual([]);
  });

  it('a 1976 start during a pending load leaves the layer suspended with no gate', async () => {
    const h = setup('haunted', undefined, 'pending');
    boot(h.controller);
    h.controller.setMode('1976');
    h.controller.requestNewGame();
    h.settlePending();
    await flush();
    expect(h.stats()).toMatchObject({ layersCreated: 1, gatesAdded: 0 });
    expect(h.layerCalls).toEqual(['1976']);
  });

  it('a failed load is logged once, leaves typing working and retries at the next Haunted start', async () => {
    const h = setup('haunted', undefined, 'reject');
    boot(h.controller);
    await flush();
    expect(h.log.entries.length).toBe(1);
    expect(h.log.entries[0]?.message).toBe('voice failed to load');
    expect(h.stats().layersCreated).toBe(0);
    h.controller.submit('in');
    h.controller.tick(0);
    expect(h.view.blocks.length).toBeGreaterThan(0);
    expect(h.log.entries.length).toBe(1);

    h.setBehavior('resolve');
    h.controller.requestNewGame();
    await flush();
    expect(h.stats()).toMatchObject({ voiceLoads: 2, layersCreated: 1, gatesAdded: 1 });
    expect(h.log.entries.length).toBe(1);
  });

  it('a synchronously throwing loader is logged once and retried', async () => {
    const log = new RecordingLogger();
    let calls = 0;
    const loader = createVoiceStartLoader({
      getHost: () => undefined,
      log,
      loadVoice: () => {
        calls++;
        throw new Error('sync');
      },
      loadHaunt: () => Promise.reject(new Error('unused')),
    });
    loader.onGameStart('haunted');
    await flush();
    expect(log.entries.length).toBe(1);
    loader.onGameStart('haunted');
    await flush();
    expect(calls).toBe(2);
  });

  it('registers the gate once on entering Haunted and removes it on entering 1976 before the first prompt', async () => {
    const h = setup('haunted');
    boot(h.controller);
    await flush();
    expect(h.stats()).toMatchObject({ gatesAdded: 1, gatesDisposed: 0 });
    // Further Haunted games reuse the one registration.
    h.controller.requestNewGame();
    expect(h.stats()).toMatchObject({ gatesAdded: 1, gatesDisposed: 0 });

    h.controller.setMode('1976');
    h.order.length = 0;
    h.controller.requestNewGame();
    expect(h.stats()).toMatchObject({ gatesAdded: 1, gatesDisposed: 1 });
    // Disposed synchronously within the start notification, then the layer is told.
    expect(h.order).toEqual(['start:1976', 'gate:dispose', 'layer:1976']);

    // Back to Haunted: registered again, exactly once.
    h.controller.setMode('haunted');
    h.controller.requestNewGame();
    expect(h.stats()).toMatchObject({ gatesAdded: 2, gatesDisposed: 1 });
  });

  it('syncHost is a no-op before the layer exists', () => {
    const h = setup('1976');
    expect(() => h.loader.syncHost()).not.toThrow();
  });
});
