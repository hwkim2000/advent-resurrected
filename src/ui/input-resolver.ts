// Input-resolution port for the GameController (AI parser seam).
// Types only: no runtime code. Imports engine types and UI types, nothing else.
// `src/parser` satisfies `InputResolver` structurally; `src/ui` never imports it.

import type { GameState } from '../engine/index';
import type { Mode, PromptKind } from './types';

export type GamePhase = 'booting' | 'ready' | 'over' | 'failed';

export interface ResolveContext {
  gameMode: Mode | undefined;
  promptKind: PromptKind | undefined;
  phase: GamePhase | undefined;
  state: GameState | undefined;
}

export type TranslateOutcome =
  | { kind: 'translated'; command: string }
  | { kind: 'fallback'; notice: boolean };

export interface InputResolver {
  /** Synchronous check: does this line need the asynchronous path? */
  needsTranslation(line: string, ctx: ResolveContext): boolean;
  /** Never rejects. */
  translate(line: string, ctx: ResolveContext, signal: AbortSignal): Promise<TranslateOutcome>;
  /** Called on every new game and restore. */
  startGame(): void;
  /** Called with the text given to the engine. */
  accepted(text: string): void;
}
