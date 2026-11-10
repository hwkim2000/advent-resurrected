/**
 * AI object disambiguation: when the model names an object the player did not
 * say, but the player's text is a near-miss of an object that is here or
 * carried (for example "grab the lab" -> LAMP), swap the object word.
 * New code; pure and total (nothing here throws).
 */
import { OBJECTS } from '../data/dungeon';
import { damerauLevenshtein } from './edit-distance';
import { validateCommand } from './command-validation';
import { lookupWord } from './vocabulary';

/** Words of one candidate object (OBJECTS[i].words); the first is canonical. */
export type ObjectCandidate = readonly string[];

const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'to', 'at', 'up', 'my', 'some', 'that', 'this', 'it', 'with', 'from', 'please', 'and',
]);

const MAX_DISTANCE = 2;
const MIN_PREFIX = 3;

/** Lower-case letters only, so look-alike and punctuation-laden table words never match. */
function letters(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Player tokens: letters, length >= 2, no stop words, no classic verbs or motions. */
function playerTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    const hit = lookupWord(raw);
    if (hit !== undefined && hit.cls !== 'object') continue;
    out.push(raw);
  }
  return out;
}

function withinBound(distance: number, token: string): boolean {
  return distance <= MAX_DISTANCE && distance < token.length;
}

/** The token shares a >= 3 letter prefix with the word, or is a bounded near-miss of it. */
function supports(token: string, word: string): boolean {
  if (commonPrefixLength(token, word) >= MIN_PREFIX) return true;
  return withinBound(damerauLevenshtein(token, word), token);
}

/** Rank of one (token, word) pair, or undefined when it is not acceptable. Lower is better. */
function rank(token: string, word: string): [number, number] | undefined {
  const distance = damerauLevenshtein(token, word);
  const prefix = token.length >= MIN_PREFIX && (word.startsWith(token) || token.startsWith(word));
  if (prefix) return [0, distance];
  if (withinBound(distance, token)) return [1, distance];
  return undefined;
}

/**
 * Returns the model's command, or the same command with its object word replaced
 * by the canonical word of the candidate that best matches the player's text.
 * The result always passes validateCommand; otherwise the model's command is returned.
 */
export function pickClosestObject(
  playerText: string,
  modelCommand: string,
  candidates: readonly ObjectCandidate[],
): string {
  try {
    const tokens = playerTokens(playerText);
    if (tokens.length === 0) return modelCommand;

    const parts = modelCommand.split(' ');
    let slot = -1;
    let modelObject: readonly string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const hit = lookupWord(parts[i]!);
      if (hit !== undefined && hit.cls === 'object') {
        slot = i;
        modelObject = objectWords(hit.id);
        break;
      }
    }
    if (slot < 0) return modelCommand;

    const modelWords = modelObject.map(letters).filter((w) => w !== '');
    for (const token of tokens) {
      if (modelWords.some((w) => supports(token, w))) return modelCommand;
    }

    let best: { key: [number, number, number]; canonical: string } | undefined;
    candidates.forEach((words, order) => {
      const canonical = words[0];
      if (canonical === undefined || letters(canonical) === '') return;
      for (const token of tokens) {
        for (const w of words) {
          const lw = letters(w);
          if (lw === '') continue;
          const r = rank(token, lw);
          if (r === undefined) continue;
          const key: [number, number, number] = [r[0], r[1], order];
          if (best === undefined || less(key, best.key)) best = { key, canonical };
        }
      }
    });
    if (best === undefined) return modelCommand;

    parts[slot] = letters(best.canonical).toUpperCase();
    const checked = validateCommand(parts.join(' '));
    return checked.ok ? checked.command : modelCommand;
  } catch {
    return modelCommand;
  }
}

function less(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

function objectWords(id: number): readonly string[] {
  return OBJECTS[id]?.words ?? [];
}
