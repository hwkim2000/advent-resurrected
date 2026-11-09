// Feature: ai-parser, Property 1: Vocabulary closure
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateCommand } from '../../../src/shared/command-validation';
import { isMetaWord } from '../../../src/shared/meta-commands';
import { lookupWord } from '../../../src/shared/vocabulary';
import { ACTIONS, MOTIONS, OBJECTS } from '../../../src/data/dungeon';
import { ALL_INJECTION_PAYLOADS } from '../../support/injection-corpus';
import { arbAdversarialText, arbProviderOutput } from '../../support/ai-generators';

const TABLE_WORDS: string[] = [...MOTIONS, ...OBJECTS, ...ACTIONS].flatMap((e) => [...e.words]);

/** Assert the closure invariant for one input; returns whether it was accepted. */
function checkClosure(input: unknown): boolean {
  let result: ReturnType<typeof validateCommand> | undefined;
  expect(() => {
    result = validateCommand(input);
  }).not.toThrow();
  if (result === undefined || !result.ok) return false;

  expect(result.command.length).toBeLessThanOrEqual(30);
  expect(result.command).toMatch(/^[A-Z]+( [A-Z]+)?$/);
  expect(result.command.split(' ')).toEqual(result.words);
  for (const w of result.words) {
    const hit = lookupWord(w);
    expect(hit).toBeDefined();
    // Canonical table spelling: the word is exactly what the lookup reports.
    expect(hit!.canonical).toBe(w);
    expect(TABLE_WORDS.map((t) => t.toUpperCase())).toContain(w);
    expect(isMetaWord(w)).toBe(false);
  }
  return true;
}

/** Vocabulary words, mangled in ways a model might produce. */
const arbNearVocabulary: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...TABLE_WORDS),
    fc.option(fc.constantFrom(...TABLE_WORDS), { nil: undefined }),
    fc.constantFrom('', '"', "'", '`', ' ', '\n', '.', 'ING', 'S'),
    fc.constantFrom('', '"', "'", '`', ' ', '\n', '.', 'ing'),
    fc.boolean(),
  )
  .map(([a, b, pre, post, lower]) => {
    const core = b === undefined ? a : `${a} ${b}`;
    const s = `${pre}${core}${post}`;
    return lower ? s.toLowerCase() : s.toUpperCase();
  });

describe('Property 1: Vocabulary closure', () => {
  /** **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 6.2** */
  it('arbitrary strings up to 10,000 characters never throw and are rejected or closed over the vocabulary', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 10_000 }),
          fc.string({ unit: 'binary', maxLength: 10_000 }),
          fc.integer({ min: 1, max: 10_000 }).map((n) => 'GO '.repeat(n).slice(0, n)),
        ),
        (s) => {
          checkClosure(s);
        },
      ),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 6.2** */
  it('non-string and adversarial provider outputs never throw and are rejected or closed', () => {
    fc.assert(
      fc.property(fc.oneof(arbProviderOutput, fc.anything(), arbAdversarialText), (v) => {
        checkClosure(v);
      }),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.7, 6.2** */
  it('mangled vocabulary words are rejected or normalized to canonical non-meta words', () => {
    let accepted = 0;
    fc.assert(
      fc.property(arbNearVocabulary, (s) => {
        if (checkClosure(s)) accepted++;
      }),
      { numRuns: 300 },
    );
    expect(accepted).toBeGreaterThan(0);
  });

  /** **Validates: Requirements 8.2, 8.3, 8.4, 6.2** */
  it('every injection-corpus string, bare or embedded, is rejected or closed', () => {
    for (const p of ALL_INJECTION_PAYLOADS) {
      checkClosure(p);
      checkClosure(`"${p}"`);
      checkClosure(`GO ${p}`);
    }
  });

  /** **Validates: Requirements 8.3, 8.4** */
  it('Meta_Command words and the NOCOMMAND token are always rejected', () => {
    for (const m of ['QUIT', 'SAVE', 'SUSPEND', 'PAUSE', 'RESUME', 'RESTART', 'SEED', 'WASTE', 'NOCOMMAND', 'GO QUIT', 'SAVE LAMP', 'quit', '"QUIT"']) {
      expect(validateCommand(m).ok, m).toBe(false);
    }
    expect(validateCommand('ENTER BUILDING')).toMatchObject({ ok: true, command: 'ENTER BUILD' });
  });
});
