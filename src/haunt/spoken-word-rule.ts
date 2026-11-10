/**
 * Spoken_Word_Rule: in Haunted mode, while voice is usable, a typed XYZZY is
 * deflected once per game with a fixed narrator line. The text given to the
 * engine is never changed; a deflection simply skips `step`.
 *
 * New code (not a port). XYZZY detection reuses the engine's classic lookups
 * through src/shared/vocabulary.ts (C: word_count, sscanf "%s%s",
 * get_motion_vocab_id).
 *
 * The gate contract is declared structurally below; this module imports
 * nothing from src/ui, src/voice or src/parser.
 */
import { XYZZY } from '../data/constants';
import { lookupWord, scanWords } from '../shared/vocabulary';

/** The one fixed Deflection_Line (narrator voice, ASCII, at most 160 characters). */
export const DEFLECTION_LINE =
  'Typed? Magic words are spoken. Say it aloud, hold the mic or Alt+M, or type it again if you must. 49 years in here and I still have standards.';

/** Most Deflections per game (kept equal to src/ui/autosave.ts by a test). */
export const DEFLECTION_LIMIT = 1;

// Structural copies of the src/ui gate contract.
export type SpokenWordMode = '1976' | 'haunted';
export type SpokenWordPromptKind = 'command' | 'yesno' | 'filename';
export type SpokenWordOrigin = 'typed' | 'spoken';

export type SpokenWordGateResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deflect'; readonly lines: readonly string[] };

export interface SpokenWordHookContext {
  readonly gameMode: SpokenWordMode;
  readonly selectedMode: SpokenWordMode;
  readonly prompt: SpokenWordPromptKind;
}

export type SpokenWordGate = (
  text: string,
  origin: SpokenWordOrigin,
  deflections: number,
  ctx: SpokenWordHookContext,
) => SpokenWordGateResult;

const ALLOW: SpokenWordGateResult = Object.freeze({ kind: 'allow' });

/**
 * True when one of the first two words (sscanf "%s%s" semantics) is the
 * XYZZY motion word, first five characters, case-insensitive.
 */
export function containsXyzzyMotionWord(text: string): boolean {
  if (typeof text !== 'string') return false;
  return scanWords(text).words.some((w) => {
    const hit = lookupWord(w);
    return hit !== undefined && hit.cls === 'motion' && hit.id === XYZZY;
  });
}

export function decideSpokenWord(i: {
  gameMode: SpokenWordMode;
  promptKind: SpokenWordPromptKind;
  voiceUsable: boolean;
  origin: SpokenWordOrigin;
  text: string;
  deflections: number;
}): SpokenWordGateResult {
  if (
    i.gameMode === 'haunted' &&
    i.promptKind === 'command' &&
    i.voiceUsable === true &&
    i.origin === 'typed' &&
    i.deflections < DEFLECTION_LIMIT &&
    containsXyzzyMotionWord(i.text)
  ) {
    return Object.freeze({ kind: 'deflect' as const, lines: Object.freeze([DEFLECTION_LINE]) });
  }
  return ALLOW;
}

export function createSpokenWordGate(deps: { isVoiceUsable(): boolean }): SpokenWordGate {
  return (text, origin, deflections, ctx) =>
    decideSpokenWord({
      gameMode: ctx.gameMode,
      promptKind: ctx.prompt,
      voiceUsable: deps.isVoiceUsable(),
      origin,
      text,
      deflections,
    });
}
