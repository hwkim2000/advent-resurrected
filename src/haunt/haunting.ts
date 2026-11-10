/**
 * Assembles the haunting layer: registers the narrator provider, the
 * dim/reincarnation observer and the maze-glitch output listener on the hooks
 * it is given. Hooks and effects are structural types (this module imports
 * nothing from src/ui); src/main.ts passes the real ones in through the loader.
 * Every callback is wrapped, so a failure here never breaks play.
 *
 * New code (not a port).
 */
import type { GameState, OutputEvent } from '../engine/index';
import { dimLevel } from './dim';
import { createGlitchPolicy } from './glitch';
import { detectMoments, type TurnInfo } from './moments';
import { createNarrator } from './narrator';
import {
  createYesNoGate,
  transformYesNo,
  type YesNoGateResult,
  type YesNoHookContext,
} from './yes-no';

/** Distinctive string for scripts/check-dist: must live only in a lazy chunk. */
export const HAUNT_CHUNK_MARKER = 'advent-haunt-chunk-marker:7f3c9a2e';

export interface HauntHookContext {
  readonly gameMode: string;
}

export interface HauntOutputBlock {
  readonly text: string;
  readonly kind: string;
}

/** The slice of ExtensionHooks used here. Method syntax keeps it assignable. */
export interface HauntHooks {
  addNarratorLineProvider(
    fn: (events: readonly OutputEvent[], ctx: HauntHookContext, turn: TurnInfo) => readonly string[],
  ): () => void;
  addEventObserver(
    fn: (events: readonly OutputEvent[], ctx: HauntHookContext, turn: TurnInfo) => void,
  ): () => void;
  addOutputListener(fn: (block: HauntOutputBlock, ctx: HauntHookContext) => void): () => void;
  addInputTransformer(fn: (line: string, ctx: YesNoHookContext) => string): () => void;
  addInputGate(
    fn: (text: string, origin: string, deflections: number, ctx: YesNoHookContext) => YesNoGateResult,
  ): () => void;
}

/** The slice of the DOM effects used here. */
export interface HauntEffectsPort {
  setDim(level: number): void;
  flashGlitch(): void;
  reincarnate(): void;
  reset(): void;
}

export interface HauntMotion {
  reduced(): boolean;
}

export interface HauntingDeps {
  hooks: HauntHooks;
  effects: HauntEffectsPort;
  motion: HauntMotion;
  /** Integer seed for the narrator picker (not the engine seed). */
  seed: number;
}

export interface Haunting {
  /** A Haunted game starts (or is restored): reset per-game state and sync the dim level. */
  gameStart(state: GameState | undefined): void;
  /** Unregister everything and clear the effects. */
  dispose(): void;
}

const MAZE_TEXT = 'all alike';

export function createHaunting(deps: HauntingDeps): Haunting {
  const { hooks, effects } = deps;
  const narrator = createNarrator({ seed: deps.seed });
  const glitchPolicy = createGlitchPolicy();
  let disposed = false;

  function safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* haunting never breaks the game */
    }
  }

  const disposers: (() => void)[] = [];
  const register = (add: () => () => void): void => {
    try {
      disposers.push(add());
    } catch {
      /* a missing hook just means less haunting */
    }
  };

  register(() =>
    hooks.addNarratorLineProvider((events, _ctx, turn) => {
      if (disposed) return [];
      try {
        return narrator.lines(turn, events);
      } catch {
        return [];
      }
    }),
  );

  register(() =>
    hooks.addEventObserver((events, _ctx, turn) => {
      if (disposed) return;
      safe(() => effects.setDim(dimLevel(turn.after.game)));
      safe(() => {
        if (detectMoments(turn, events).some((m) => m.kind === 'reincarnated')) {
          effects.reincarnate();
        }
      });
    }),
  );

  register(() =>
    hooks.addOutputListener((block) => {
      if (disposed) return;
      safe(() => {
        if (block.kind !== 'original' || !block.text.includes(MAZE_TEXT)) return;
        if (glitchPolicy.visit()) effects.flashGlitch();
      });
    }),
  );

  const yesNoGate = createYesNoGate();
  register(() => hooks.addInputTransformer((line, ctx) => {
    try {
      return disposed ? line : transformYesNo(line, ctx);
    } catch {
      return line;
    }
  }));
  register(() => hooks.addInputGate((text, origin, deflections, ctx) => {
    try {
      return disposed ? { kind: 'allow' } : yesNoGate(text, origin, deflections, ctx);
    } catch {
      return { kind: 'allow' };
    }
  }));

  return {
    gameStart(state) {
      if (disposed) return;
      safe(() => narrator.gameStart());
      safe(() => glitchPolicy.reset());
      if (state !== undefined) safe(() => effects.setDim(dimLevel(state.game)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const d of disposers.splice(0)) safe(d);
      safe(() => narrator.reset());
      safe(() => effects.reset());
    },
  };
}
