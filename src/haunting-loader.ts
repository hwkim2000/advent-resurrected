// Lazy haunting loading policy (haunting spec, Requirements 1-5 and 7). No
// reference to src/haunt here: main.ts supplies the dynamic import()s.
// Structural types only, the same pattern as ai-loader.ts and voice-loader.ts.

import type { GameState } from './engine/index';
import type { ExtensionHooks } from './ui/extension-hooks';
import type { Logger, KeyValueStore, Mode, MotionPreference } from './ui/types';

export interface HauntingHandle {
  gameStart(state: GameState | undefined): void;
  dispose(): void;
}

export interface HauntEffectsHandle {
  setDim(level: number): void;
  flashGlitch(): void;
  reincarnate(): void;
  reset(): void;
  /** Haunted game start hook for Ghost_Voice (optional so older fakes still fit). */
  start?(): void;
}

/** The lazy src/haunt/haunting chunk. */
export interface HauntingModule {
  /** Queue factory handed to the UI effects (src/ui cannot import src/haunt). */
  createSpeechQueue?: <T>(deps: {
    player: { play(item: T, onEnd: () => void): void; stop(): void };
    now(): number;
  }) => { offer(item: T): void; cancel(): void; isPlaying(): boolean; hasWaiting(): boolean };
  createHaunting(deps: {
    hooks: ExtensionHooks;
    effects: HauntEffectsHandle;
    motion: MotionPreference;
    seed: number;
    getState(): GameState | undefined;
  }): HauntingHandle;
}

/** The lazy src/ui/dom/haunt-effects chunk. */
export interface HauntEffectsModule {
  createHauntEffects(deps: {
    motion: MotionPreference;
    kv?: KeyValueStore;
    log?: Logger;
    createQueue?: HauntingModule['createSpeechQueue'];
  }): HauntEffectsHandle;
}

export interface HauntingHost {
  readonly hooks: ExtensionHooks;
  readonly motion: MotionPreference;
  readonly engineState: GameState | undefined;
}

export interface HauntingLoaderDeps {
  getHost(): HauntingHost | undefined;
  log: Logger;
  loadHaunting(): Promise<HauntingModule>;
  loadEffects(): Promise<HauntEffectsModule>;
  /** Seed for the narrator picker; main.ts decides (for example Date.now()). */
  seed: number;
  /** Key-value store for the VOICE toggle preference; without it Ghost_Voice stays off. */
  kv?: KeyValueStore;
}

/**
 * Loads the haunt and effects chunks on the first Haunted game start (never in
 * 1976 mode, one load at a time, a successful load is kept). On every Haunted
 * start it calls gameStart with the engine state; on a 1976 start it disposes
 * the haunting and resets the effects. Never awaited on the game path.
 */
export function createHauntingLoader(deps: HauntingLoaderDeps): (mode: Mode) => void {
  let latestMode: Mode | undefined;
  let loading = false;
  let modules: { haunting: HauntingModule; effects: HauntEffectsModule } | undefined;
  let effects: HauntEffectsHandle | undefined;
  let active: HauntingHandle | undefined;

  function deactivate(): void {
    const a = active;
    active = undefined;
    try {
      a?.dispose();
    } catch (e) {
      deps.log.error('haunting dispose failed', e);
    }
    try {
      effects?.reset();
    } catch (e) {
      deps.log.error('haunt effects reset failed', e);
    }
  }

  function apply(): void {
    if (modules === undefined) return;
    try {
      const host = deps.getHost();
      if (host === undefined) throw new Error('haunting host unavailable');
      if (active === undefined) {
        effects ??= modules.effects.createHauntEffects({
          motion: host.motion,
          log: deps.log,
          ...(deps.kv !== undefined ? { kv: deps.kv } : {}),
          ...(modules.haunting.createSpeechQueue !== undefined
            ? { createQueue: modules.haunting.createSpeechQueue }
            : {}),
        });
        active = modules.haunting.createHaunting({
          hooks: host.hooks,
          effects,
          motion: host.motion,
          seed: deps.seed,
          getState: () => deps.getHost()?.engineState,
        });
      }
      try {
        effects?.start?.();
      } catch (e) {
        deps.log.error('ghost voice failed to start', e);
      }
      active.gameStart(host.engineState);
    } catch (e) {
      deps.log.error('haunting failed to start', e);
    }
  }

  function startLoad(): void {
    loading = true;
    let pending: Promise<[HauntingModule, HauntEffectsModule]>;
    try {
      pending = Promise.all([deps.loadHaunting(), deps.loadEffects()]);
    } catch (e) {
      loading = false;
      deps.log.error('haunting failed to load', e);
      return;
    }
    pending.then(
      ([haunting, fx]) => {
        loading = false;
        modules = { haunting, effects: fx };
        if (latestMode === 'haunted') apply();
      },
      (e: unknown) => {
        loading = false;
        deps.log.error('haunting failed to load', e);
      },
    );
  }

  return (mode) => {
    latestMode = mode;
    if (mode === '1976') {
      deactivate();
      return;
    }
    if (modules !== undefined) {
      apply();
      return;
    }
    if (!loading) startLoad();
  };
}
