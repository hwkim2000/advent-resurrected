// kiro-tooling task 3.1: one consolidated lint over every narrator-side line (voiceLines() and
// each exported pool). Original-game text is not linted.
import { describe, expect, it } from 'vitest';
import { HINT_POOLS } from '../../src/haunt/hints';
import { ALL_POOLS, MAX_LINE_LENGTH, REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { DEFLECTION_LINE } from '../../src/haunt/spoken-word-rule';
import { voiceLines } from '../../src/haunt/voice-lines';
import { NUDGE_LINES } from '../../src/haunt/yes-no';
import { BANNED_PHRASES, BANNED_WORDS } from './banned-words';

const sources: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['voiceLines', voiceLines()],
  ...Object.entries(ALL_POOLS).map(([k, v]) => [`ALL_POOLS.${k}`, v] as const),
  ...Object.entries(HINT_POOLS).map(([k, v]) => [`HINT_POOLS.${k}`, v] as const),
  ['NUDGE_LINES', NUDGE_LINES],
  ['DEFLECTION_LINE', [DEFLECTION_LINE]],
  ['REINCARNATION_COUNTDOWN', [REINCARNATION_COUNTDOWN]],
];

describe('narrator line lint', () => {
  it('covers a non-trivial number of lines', () => {
    expect(voiceLines().length).toBeGreaterThan(50);
  });

  for (const [name, lines] of sources) {
    it(`${name}: non-empty, trimmed, <= ${MAX_LINE_LENGTH} chars, printable ASCII, no banned words`, () => {
      expect(lines.length, name).toBeGreaterThan(0);
      for (const l of lines) {
        const ctx = `${name}: ${l}`;
        expect(l.length, ctx).toBeGreaterThan(0);
        expect(l, ctx).toBe(l.trim());
        expect(l.length, ctx).toBeLessThanOrEqual(MAX_LINE_LENGTH);
        expect(/^[\x20-\x7e]+$/.test(l), ctx).toBe(true);
        expect(BANNED_PHRASES.test(l), ctx).toBe(false);
        expect(BANNED_WORDS.test(l), ctx).toBe(false);
      }
    });
  }

  it('voiceLines() has no duplicates', () => {
    const all = voiceLines();
    expect(new Set(all).size).toBe(all.length);
  });

  it('no line appears in two different pools', () => {
    const owner = new Map<string, string>();
    for (const [name, lines] of sources) {
      if (name === 'voiceLines') continue;
      for (const l of lines) {
        const prev = owner.get(l);
        expect(prev === undefined || prev === name, `"${l}" is in ${prev} and ${name}`).toBe(true);
        owner.set(l, name);
      }
    }
  });
});
