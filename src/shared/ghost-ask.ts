/**
 * Recognition of "ask the ghost for help" lines, shared by the AI parser
 * (eligibility, response sentinel), the Parse_Endpoint and the Haunted-mode
 * hint gate. Pure and total. New code; not ported from Open Adventure.
 *
 * `GHOST` is a reserved token, not a vocabulary word: validateCommand rejects
 * it, so both sides handle it before validation.
 */
import { normalizePlayerText } from './normalize';

/** The reserved answer / translated text that means "the player wants a hint". */
export const GHOST_TOKEN = 'GHOST';

/** First word is "ghost" (optionally after "hey"/"oh"); "ghostly" does not match. */
const GHOST_PREFIX = /^(?:(?:hey|oh)[\s,]+)?ghost(?=$|[\s,.!?;:])/i;

/** Exact help phrases: lowercase, apostrophes dropped, trailing punctuation stripped. */
export const GHOST_PHRASES: readonly string[] = [
  'im stuck',
  'i am stuck',
  'what now',
  'what do i do',
  'where do i go',
  'help me',
];

function normalizePhrase(text: string): string {
  return normalizePlayerText(text)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[?!.\s]+$/, '');
}

/** The line begins with the word "ghost". */
export function isGhostPrefixAsk(text: string): boolean {
  try {
    return GHOST_PREFIX.test(normalizePlayerText(text));
  } catch {
    return false;
  }
}

/** The line is one of the exact stuck/help phrases. */
export function isGhostPhrase(text: string): boolean {
  try {
    return GHOST_PHRASES.includes(normalizePhrase(text));
  } catch {
    return false;
  }
}

/** True for a model/wire answer that is exactly GHOST (trimmed, case-insensitive). */
export function isGhostToken(text: string): boolean {
  return typeof text === 'string' && text.trim().toUpperCase() === GHOST_TOKEN;
}

/** Prefix, exact phrase, or the token itself. */
export function isGhostAsk(text: string): boolean {
  return isGhostPrefixAsk(text) || isGhostPhrase(text) || isGhostToken(text);
}
