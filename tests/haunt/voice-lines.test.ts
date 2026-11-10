// ghost-voice task 1.3: Voice_Key stability, normalization and line coverage.
import { describe, expect, it } from 'vitest';
import { ALL_POOLS, REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { DEFLECTION_LINE } from '../../src/haunt/spoken-word-rule';
import { normalizeVoiceLine, voiceKey, voiceLines } from '../../src/haunt/voice-lines';
import { NUDGE_LINES } from '../../src/haunt/yes-no';

describe('voice-lines', () => {
  it('normalizes whitespace and trailing newlines', () => {
    expect(normalizeVoiceLine('  a \n  b\t c\n')).toBe('a b c');
  });

  it('keys are 8 hex chars, stable, and ignore whitespace differences', () => {
    expect(voiceKey('Hello there')).toMatch(/^[0-9a-f]{8}$/);
    expect(voiceKey('Hello there')).toBe(voiceKey('Hello there'));
    expect(voiceKey('Hello there\n')).toBe(voiceKey('  Hello   there '));
    expect(voiceKey('Hello there')).not.toBe(voiceKey('Hello there!'));
  });

  it('has a known FNV-1a value (stability across releases)', () => {
    // FNV-1a 32 of "a" is e40c292c.
    expect(voiceKey('a')).toBe('e40c292c');
    expect(voiceKey('')).toBe('811c9dc5');
  });

  it('voiceLines is unique, sorted and deterministic', () => {
    const a = voiceLines();
    const b = voiceLines();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect([...a].sort()).toEqual([...a]);
    expect(a.length).toBeGreaterThan(40);
  });

  it('has no key collisions', () => {
    const keys = voiceLines().map(voiceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every pool entry, the countdown, nudges and the deflection', () => {
    const set = new Set(voiceLines());
    const expected = [
      REINCARNATION_COUNTDOWN,
      DEFLECTION_LINE,
      ...NUDGE_LINES,
      ...Object.values(ALL_POOLS).flat(),
    ];
    for (const line of expected) expect(set.has(normalizeVoiceLine(line))).toBe(true);
  });
});
