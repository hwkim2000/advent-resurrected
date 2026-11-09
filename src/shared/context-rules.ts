/**
 * Game_Context shape and the room/object value sets, derived only from
 * generated game data in src/data. New code; not ported from Open Adventure.
 */
import { LOCATIONS, OBJECTS } from '../data/dungeon';
import { isContextCommand } from './command-validation';
import {
  COMMAND_MAX_CHARS,
  DARK_ROOM,
  LAST_MAX,
  OBJECT_WORD_MAX,
  OBJECTS_MAX,
  ROOM_MAX_CHARS,
} from './limits';

export interface GameContext {
  room: string;
  objects: string[];
  last: string[];
}

/** Typographic single and double quotes, and ASCII double quote, all become an apostrophe. */
const QUOTE_CHARS = /[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u201F\u2033"]/g;
/** Everything outside letters, digits, space and ' . , / - */
const DISALLOWED_CHARS = /[^A-Za-z0-9 '.,/-]/g;

/** Sanitize a room description (Requirement 2.8). */
function sanitizeRoom(raw: string): string {
  return raw
    .replace(QUOTE_CHARS, "'")
    .replace(DISALLOWED_CHARS, ' ')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, ROOM_MAX_CHARS)
    .trim();
}

/**
 * Short description of a location, sanitized: `small`, or the first line of
 * `big` when `small` is null. Returns '' for a location with no text.
 */
export function roomText(loc: number): string {
  const def = LOCATIONS[loc];
  if (def === undefined) return '';
  const raw = def.small ?? (def.big === null ? '' : (def.big.split('\n')[0] ?? ''));
  return sanitizeRoom(raw);
}

function buildRoomSet(): ReadonlySet<string> {
  const set = new Set<string>([DARK_ROOM]);
  for (let i = 0; i < LOCATIONS.length; i++) {
    const text = roomText(i);
    if (text !== '') set.add(text);
  }
  return set;
}

function buildObjectWords(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const obj of OBJECTS) {
    const first = obj.words[0];
    if (first !== undefined) set.add(first.toUpperCase());
  }
  return set;
}

/** Every sanitized room string with text, plus DARK_ROOM. */
export const ROOM_SET: ReadonlySet<string> = buildRoomSet();

/**
 * Upper-case first word of each object that has words. The generated data has
 * 69 such objects but some share a first word, so the set holds 66 distinct
 * values (all 1 to 5 letters, well inside OBJECT_WORD_MAX).
 */
export const OBJECT_WORDS: ReadonlySet<string> = buildObjectWords();

const CONTEXT_KEYS = ['last', 'objects', 'room'];
const OBJECT_WORD_SHAPE = /^[A-Z]+$/;
const LAST_SHAPE = /^[A-Z]+( [A-Z]+)?$/;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/**
 * Strict Game_Context check used by both the client and the Parse_Endpoint:
 * exact key set, room in ROOM_SET, objects drawn from OBJECT_WORDS, and last
 * holding canonical non-meta commands. Total: never throws.
 */
export function validateContext(x: unknown): x is GameContext {
  try {
    if (!isPlainObject(x)) return false;
    const keys = Object.keys(x).sort();
    if (keys.length !== CONTEXT_KEYS.length || keys.some((k, i) => k !== CONTEXT_KEYS[i])) return false;

    const { room, objects, last } = x;
    if (typeof room !== 'string' || !ROOM_SET.has(room)) return false;

    if (!Array.isArray(objects) || objects.length > OBJECTS_MAX) return false;
    for (const o of objects as unknown[]) {
      if (typeof o !== 'string' || o.length < 1 || o.length > OBJECT_WORD_MAX) return false;
      if (!OBJECT_WORD_SHAPE.test(o) || !OBJECT_WORDS.has(o)) return false;
    }

    if (!Array.isArray(last) || last.length > LAST_MAX) return false;
    for (const l of last as unknown[]) {
      if (typeof l !== 'string' || l.length > COMMAND_MAX_CHARS || !LAST_SHAPE.test(l)) return false;
      if (!isContextCommand(l)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
