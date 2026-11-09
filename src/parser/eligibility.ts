/**
 * Decides whether a typed line goes to the AI. Pure; new code, not ported
 * from Open Adventure. Classic-command detection uses the engine's own lookup.
 */
import type { GameState } from '../engine';
import { isClassicCommandText } from '../shared/command-validation';
import { TEXT_MAX_CHARS } from '../shared/limits';
import { hasControlChars, hasLoneSurrogate, normalizePlayerText } from '../shared/normalize';

export interface ResolveInput {
  gameMode: 'haunted' | '1976' | undefined;
  promptKind: 'command' | 'yesno' | 'filename' | undefined;
  phase: 'booting' | 'ready' | 'over' | 'failed' | undefined;
  state: GameState | undefined;
}

export type Eligibility =
  | { kind: 'pass' } // give the line to the engine unchanged, no request
  | { kind: 'fallback-no-request' } // over 200 characters or unsafe text
  | { kind: 'ask'; text: string }; // normalized text to send

/** Empty, whitespace-only, or digits with an optional sign (numeric answers). */
const NUMERIC_OR_BLANK = /^\s*[+-]?[0-9\s]*$/;

export function classifyInput(line: string, input: ResolveInput): Eligibility {
  const { gameMode, promptKind, phase, state } = input;
  if (
    gameMode === undefined ||
    promptKind === undefined ||
    phase === undefined ||
    state === undefined ||
    gameMode !== 'haunted' ||
    promptKind !== 'command' ||
    state.session.pending.k !== 'command' ||
    phase !== 'ready'
  ) {
    return { kind: 'pass' };
  }

  if (NUMERIC_OR_BLANK.test(line)) return { kind: 'pass' };

  if (isClassicCommandText(line, state.game.zzword, state.session.settings.oldstyle)) {
    return { kind: 'pass' };
  }

  const text = normalizePlayerText(line);
  if (text.length === 0) return { kind: 'pass' };
  if (text.length > TEXT_MAX_CHARS || hasControlChars(text) || hasLoneSurrogate(text)) {
    return { kind: 'fallback-no-request' };
  }
  return { kind: 'ask', text };
}
