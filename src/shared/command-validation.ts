/**
 * Command validation shared by the Parse_Endpoint and the AI parser.
 * New code; vocabulary comes from the engine lookups (see vocabulary.ts).
 * Pure and total: nothing here throws.
 */
import { NO_WORD_TYPE, getVocabMetadata } from '../engine/classic-parser';
import { COMMAND_MAX_CHARS } from './limits';
import { isMetaWord } from './meta-commands';
import { lookupWord, scanWords } from './vocabulary';

export type CommandResult = { ok: true; command: string; words: string[] } | { ok: false };

const REJECT: CommandResult = { ok: false };
const CANDIDATE = /^[A-Z]+( [A-Z]+)?$/;
const QUOTES = new Set(['"', "'", '`']);

/** Upper-case ASCII letters only, so look-alikes such as U+0131 stay as they are. */
function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

/**
 * Reduce provider output (or a 200 body command) to a canonical Classic_Command
 * that contains no Meta_Command word, or reject it.
 */
export function validateCommand(raw: unknown): CommandResult {
  try {
    if (typeof raw !== 'string') return REJECT;
    // Bound the work for huge adversarial strings before any further processing.
    if (raw.length > 10_000) return REJECT;

    let s = raw.trim();
    if (s.length >= 2) {
      const first = s[0]!;
      if (QUOTES.has(first) && s[s.length - 1] === first) s = s.slice(1, -1);
    }
    s = asciiUpper(s);

    if (s.length < 1 || s.length > COMMAND_MAX_CHARS) return REJECT;
    if (!CANDIDATE.test(s)) return REJECT;

    const words: string[] = [];
    for (const w of s.split(' ')) {
      const hit = lookupWord(w);
      if (hit === undefined) return REJECT;
      if (isMetaWord(w)) return REJECT;
      words.push(hit.canonical);
    }
    return { ok: true, command: words.join(' '), words };
  } catch {
    return REJECT;
  }
}

/**
 * True when the engine's own lookup would treat the text as a classic command:
 * one or two words (C word_count) and every scanned word has a type other than
 * NO_WORD_TYPE (C get_vocab_metadata; numbers and the reservoir word count).
 */
export function isClassicCommandText(text: string, zzword: string, oldstyle: boolean): boolean {
  const { count, words } = scanWords(text);
  if (count < 1 || count > 2 || words.length === 0) return false;
  return words.every((w) => getVocabMetadata(w, zzword, oldstyle).type !== NO_WORD_TYPE);
}

/** For Game_Context.last: a canonical, non-meta command. */
export function isContextCommand(entry: string): boolean {
  const r = validateCommand(entry);
  return r.ok && r.command === entry;
}
