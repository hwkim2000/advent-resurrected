/**
 * Single vocabulary lookup for the AI parser, delegating to the engine's
 * classic lookups. New code; the lookups themselves are ported in
 * src/engine/classic-parser.ts (C: get_motion_vocab_id, get_object_vocab_id,
 * get_action_vocab_id, get_vocab_metadata, word_count, sscanf "%s%s").
 * No hand-written word list: words come from src/data via the engine.
 */
import { PART } from '../data/constants';
import { ACTIONS, MOTIONS, OBJECTS } from '../data/dungeon';
import {
  getActionVocabId,
  getMotionVocabId,
  getObjectVocabId,
  scanTwoWords,
  strncaseeq,
  wordCount,
} from '../engine/classic-parser';
import { TOKLEN, WORD_NOT_FOUND } from '../engine/objects';

export type WordClass = 'motion' | 'object' | 'action';

export interface VocabHit {
  cls: WordClass;
  id: number;
  /** The matched table word, upper case (for example ENTER, BUILD, INSID). */
  canonical: string;
}

/** The table word of `words` that matches `word` on the first TOKLEN characters. */
function canonicalOf(word: string, words: readonly string[] | null | undefined): string | undefined {
  for (const w of words ?? []) {
    if (strncaseeq(word, w, TOKLEN)) return w.toUpperCase();
  }
  return undefined;
}

/**
 * Look a word up in the order of C get_vocab_metadata: motion, object, action.
 * oldstyle is always false (the AI runs only in Haunted mode). The reservoir
 * word (PART) is not a vocabulary word and is rejected.
 */
export function lookupWord(word: string): VocabHit | undefined {
  if (word === '') return undefined;

  const m = getMotionVocabId(word, false);
  if (m !== WORD_NOT_FOUND) {
    const canonical = canonicalOf(word, MOTIONS[m]?.words);
    return canonical === undefined ? undefined : { cls: 'motion', id: m, canonical };
  }

  const o = getObjectVocabId(word);
  if (o !== WORD_NOT_FOUND) {
    const canonical = canonicalOf(word, OBJECTS[o]?.words);
    return canonical === undefined ? undefined : { cls: 'object', id: o, canonical };
  }

  const a = getActionVocabId(word, false);
  if (a !== WORD_NOT_FOUND && a !== PART) {
    const canonical = canonicalOf(word, ACTIONS[a]?.words);
    return canonical === undefined ? undefined : { cls: 'action', id: a, canonical };
  }

  return undefined;
}

/** True when the word resolves to a motion, object or action (not PART). */
export function isVocabularyWord(word: string): boolean {
  return lookupWord(word) !== undefined;
}

/**
 * Mirrors the engine: `count` is C word_count (space and tab delimiters) and
 * `words` are the first two non-empty tokens from the sscanf "%s%s" scan.
 */
export function scanWords(text: string): { count: number; words: string[] } {
  const count = wordCount(text);
  const words = scanTwoWords(text).filter((w) => w !== '');
  return { count, words };
}
