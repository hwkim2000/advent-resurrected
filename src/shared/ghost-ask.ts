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

/** Longest line the broad matcher considers (a help question is short). */
const HELP_QUESTION_MAX_CHARS = 120;

/** Lowercase, apostrophes dropped, other punctuation to spaces, spaces collapsed. */
function plainWords(text: string): string {
  return normalizePlayerText(text)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "not stuck", "never lost": the player says they do not need help. */
const NEGATED = /\b(?:not|isnt|arent|wasnt|never|wont)\s+(?:\w+\s+)?(?:stuck|lost|confused|clueless)\b/;

/**
 * Broad offline matcher for stuck / lost / hint / clue / advice / "what now" style
 * sentences, so help questions never need the AI. Plain HELP and INFO are not matched
 * (a bare help word is not enough); they stay classic commands.
 */
const HELP_PATTERNS: readonly RegExp[] = [
  /\bstuck\b/,
  /\b(?:i am|im|am i|totally|completely|really|so|feel|feeling|getting|a bit|kind of)\s+(?:\w+\s+)?(?:lost|confused|clueless)\b/,
  /\b(?:hint|hints|clue|clues|advice|nudge|nudges|tip|tips|pointer|pointers|guidance)\b/,
  /\bno\s+(?:idea|clue)\b/,
  /\b(?:dont|do not|didnt|cant)\s+(?:know|tell|figure|work out)\s+(?:what|where|how|which)\b/,
  /\bwhat\s+(?:should|shall|can|do|must|to)\s+(?:i|we)?\s*(?:do|try)\b/,
  /\bwhat\s+(?:now|next)\b/,
  /\bwhat\s+to\s+do\b/,
  /\bwhat\s+(?:am\s+i|are\s+we)\s+(?:supposed|meant)\s+to\s+do\b/,
  /\bwhere\s+(?:should|shall|can|do|must)\s+(?:i|we)\s+(?:go|head|look|start|turn)\b/,
  /\bwhere\s+(?:am\s+i|are\s+we)\s+(?:supposed|meant)\s+to\s+go\b/,
  /\bwhere\s+to\s+(?:go|start|next|head)\b/,
  /\b(?:need|want|require|could use|can i get|can i have)\s+(?:some\s+|a\s+|any\s+)?help\b/,
  /\bany\s+help\b/,
  /\bcan\s+you\s+help\b/,
  /\bhelp\s+me\b/,
  /\bhow\s+(?:do|can|should)\s+(?:i|we)\s+(?:proceed|continue|progress|advance|get started|begin|win)\b/,
  /\bwhat\s+is\s+the\s+(?:goal|point|objective)\b/,
  /\bi\s+give\s+up\b/,
];

/** The line is a stuck / help / hint question (broad, offline, never classic HELP or INFO). */
export function isGhostHelpQuestion(text: string): boolean {
  try {
    const words = plainWords(text);
    if (words === '' || words.length > HELP_QUESTION_MAX_CHARS) return false;
    if (NEGATED.test(words)) return false;
    return HELP_PATTERNS.some((p) => p.test(words));
  } catch {
    return false;
  }
}

/** Handled client-side without the AI: ghost prefix, exact phrase, or a broad help question. */
export function isGhostOfflineAsk(text: string): boolean {
  return isGhostPrefixAsk(text) || isGhostPhrase(text) || isGhostHelpQuestion(text);
}

/** Prefix, exact phrase, help question, or the token itself. */
export function isGhostAsk(text: string): boolean {
  return isGhostOfflineAsk(text) || isGhostToken(text);
}
