// Feature: ai-parser, Property 8: Codec round trip and size bound
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ACTIONS, MOTIONS, OBJECTS } from '../../../src/data/dungeon';
import { isContextCommand, validateCommand } from '../../../src/shared/command-validation';
import { OBJECT_WORDS, ROOM_SET, validateContext, type GameContext } from '../../../src/shared/context-rules';
import {
  BODY_MAX_BYTES,
  COMMAND_MAX_CHARS,
  LAST_MAX,
  OBJECTS_MAX,
  TEXT_MAX_CHARS,
} from '../../../src/shared/limits';
import {
  decodeRequest,
  decodeSuccess,
  encodeRequest,
  encodeSuccess,
  type ParseRequest,
} from '../../../src/shared/protocol';

const RUNS = { numRuns: 200 };

const ROOMS = [...ROOM_SET].sort();
const OBJECT_LIST = [...OBJECT_WORDS].sort();

// Canonical single words that are valid in Game_Context.last (no meta words).
const CONTEXT_WORDS = [...MOTIONS, ...OBJECTS, ...ACTIONS]
  .flatMap((e) => [...e.words])
  .map((w) => w.toUpperCase())
  .filter((w) => isContextCommand(w));
const UNIQUE_WORDS = [...new Set(CONTEXT_WORDS)].sort();

const arbWord = fc.constantFrom(...UNIQUE_WORDS);
const arbLastEntry = fc
  .oneof(arbWord, fc.tuple(arbWord, arbWord).map(([a, b]) => `${a} ${b}`))
  .filter((s) => isContextCommand(s));

const arbContext: fc.Arbitrary<GameContext> = fc.record({
  room: fc.constantFrom(...ROOMS),
  objects: fc.uniqueArray(fc.constantFrom(...OBJECT_LIST), { maxLength: OBJECTS_MAX }),
  last: fc.array(arbLastEntry, { maxLength: LAST_MAX }),
});

/** Text of 1..200 code points with no control characters (U+0000-U+001F, U+007F) and no lone surrogates. */
const arbCodePoint = fc
  .oneof(
    fc.integer({ min: 0x20, max: 0x7e }),
    fc.integer({ min: 0xa0, max: 0xd7ff }),
    fc.integer({ min: 0xe000, max: 0xfffd }),
    fc.integer({ min: 0x10000, max: 0x10ffff }),
  )
  .map((cp) => String.fromCodePoint(cp));
const arbText = fc
  .array(arbCodePoint, { minLength: 1, maxLength: TEXT_MAX_CHARS })
  .map((a) => a.join(''));

const arbRequest: fc.Arbitrary<ParseRequest> = fc.record({ text: arbText, context: arbContext });

describe('Property 8: Codec round trip and size bound', () => {
  it('generators are non-empty and produce valid contexts', () => {
    expect(ROOMS.length).toBeGreaterThan(1);
    expect(OBJECT_LIST.length).toBeGreaterThan(OBJECTS_MAX);
    expect(UNIQUE_WORDS.length).toBeGreaterThan(10);
  });

  it('decodeRequest(JSON.parse(encodeRequest(x))) equals x and fits the body limit', () => {
    fc.assert(
      fc.property(arbRequest, (x) => {
        expect(validateContext(x.context)).toBe(true);
        const body = encodeRequest(x);
        expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(BODY_MAX_BYTES);
        expect(decodeRequest(JSON.parse(body))).toEqual(x);
      }),
      RUNS,
    );
  });

  it('worst case: 200 four-byte characters, 12 longest objects, 2 longest last entries, longest room', () => {
    const longestRoom = ROOMS.reduce((a, b) => (b.length > a.length ? b : a));
    const longestObjects = [...OBJECT_LIST]
      .sort((a, b) => b.length - a.length)
      .slice(0, OBJECTS_MAX);
    const lastCandidates: string[] = [];
    for (const a of UNIQUE_WORDS) for (const b of UNIQUE_WORDS) lastCandidates.push(`${a} ${b}`);
    const longestLast = lastCandidates
      .filter((s) => isContextCommand(s))
      .sort((a, b) => b.length - a.length)
      .slice(0, LAST_MAX);
    expect(longestLast.length).toBe(LAST_MAX);
    for (const l of longestLast) expect(l.length).toBeLessThanOrEqual(COMMAND_MAX_CHARS);

    const x: ParseRequest = {
      text: '\u{1F47B}'.repeat(TEXT_MAX_CHARS),
      context: { room: longestRoom, objects: longestObjects, last: longestLast },
    };
    expect(validateContext(x.context)).toBe(true);
    const body = encodeRequest(x);
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(BODY_MAX_BYTES);
    expect(decodeRequest(JSON.parse(body))).toEqual(x);
  });

  it('decodeSuccess(JSON.parse(encodeSuccess(c))) equals c for accepted commands', () => {
    const arbCommand = fc
      .oneof(arbWord, fc.tuple(arbWord, arbWord).map(([a, b]) => `${a} ${b}`))
      .filter((s) => validateCommand(s).ok);
    fc.assert(
      fc.property(arbCommand, (c) => {
        expect(decodeSuccess(JSON.parse(encodeSuccess(c)))).toBe(c);
      }),
      RUNS,
    );
  });
});
