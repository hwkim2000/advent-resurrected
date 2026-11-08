// Feature: game-engine, Property 5: Step is total
// **Validates: Requirements 3.7, 6.8, 16.1**
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newGame, start, step } from '../../src/engine';
import type { GameState, Pending } from '../../src/engine';
import { HINTS, OBITUARIES } from '../../src/data/dungeon';
import { actionWord, makeEnv, objectWord, motionWord, seedArb, vocabCommand } from '../support/generators';

const pendingArb: fc.Arbitrary<Pending> = fc.oneof(
  fc.constant<Pending>({ k: 'novice' }),
  fc.constant<Pending>({ k: 'command' }),
  fc.integer({ min: 0, max: HINTS.length - 1 }).map<Pending>((hint) => ({ k: 'hint-question', hint })),
  fc.integer({ min: 0, max: HINTS.length - 1 }).map<Pending>((hint) => ({ k: 'hint-confirm', hint })),
  fc
    .tuple(
      fc.constantFrom('dwarf', 'nowhere', 'pit', 'bridge'),
      fc.integer({ min: 0, max: OBITUARIES.length - 1 }),
    )
    .map<Pending>(([origin, obit]) => ({ k: 'croak', origin, obit })),
  fc.constant<Pending>({ k: 'dragon' }),
  fc.constant<Pending>({ k: 'quit' }),
  fc.constant<Pending>({ k: 'clue' }),
  fc.constant<Pending>({ k: 'suspend-confirm' }),
  fc.constant<Pending>({ k: 'suspend-file' }),
  fc.constant<Pending>({ k: 'resume-confirm' }),
  fc.constant<Pending>({ k: 'resume-file' }),
);

/** A started game forced into the given pending tag. */
function stateWith(seed: number, pending: Pending): GameState {
  const state = start(newGame(seed), makeEnv()).state;
  state.session.pending = pending;
  return state;
}

/** Arbitrary text, including non-ASCII, control characters and lone surrogates, up to ~100k units. */
const bigText: fc.Arbitrary<string> = fc
  .tuple(fc.string({ unit: 'binary', maxLength: 500 }), fc.integer({ min: 1, max: 200 }))
  .map(([s, n]) => (s.length === 0 ? '' : s.repeat(n)).slice(0, 100_000));

const anyText: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 200 }),
  fc.string({ unit: 'grapheme-ascii', maxLength: 200 }),
  fc.constantFrom('', ' ', '\t\n\r', '   \u0000  ', '\u00e9\u4e2d\u{1F600}', '\ud800', '\u2028'),
  bigText,
);

describe('Property 5: Step is total', () => {
  it('never throws and always returns a result for arbitrary text and any pending tag', () => {
    fc.assert(
      fc.property(seedArb, pendingArb, anyText, (seed, pending, text) => {
        const state = stateWith(seed, pending);
        const r = step(state, text, makeEnv());
        expect(r).toBeDefined();
        expect(r.state).toBeDefined();
        expect(Array.isArray(r.events)).toBe(true);
      }),
      { numRuns: 100, verbose: 1 },
    );
  });

  it('handles a maximum-length 100,000-unit line (and whitespace-only) in every pending state', () => {
    const inputs = ['x'.repeat(100_000), ' '.repeat(100_000), 'a b '.repeat(25_000), ''];
    const kinds: Pending[] = [
      { k: 'novice' }, { k: 'command' }, { k: 'hint-question', hint: 0 },
      { k: 'hint-confirm', hint: 0 }, { k: 'croak', origin: 'dwarf', obit: 0 },
      { k: 'dragon' }, { k: 'quit' }, { k: 'clue' }, { k: 'suspend-confirm' },
      { k: 'suspend-file' }, { k: 'resume-confirm' }, { k: 'resume-file' },
    ];
    for (const p of kinds) {
      for (const text of inputs) {
        expect(() => step(stateWith(1, p), text, makeEnv())).not.toThrow();
      }
    }
  });

  it('never throws for random verb/object pairs built from the vocabulary', () => {
    fc.assert(
      fc.property(
        seedArb,
        pendingArb,
        fc.oneof(
          vocabCommand,
          fc.tuple(actionWord, objectWord).map(([v, o]) => `${v} ${o}`),
          fc.tuple(motionWord, objectWord).map(([v, o]) => `${v} ${o}`),
          fc.tuple(objectWord, actionWord).map(([o, v]) => `${o} ${v}`),
        ),
        (seed, pending, line) => {
          const r = step(stateWith(seed, pending), line, makeEnv());
          expect(r.state).toBeDefined();
          expect(Array.isArray(r.events)).toBe(true);
        },
      ),
      { numRuns: 100, verbose: 1 },
    );
  });

  it('stays total over a whole sequence of arbitrary lines', () => {
    fc.assert(
      fc.property(seedArb, fc.array(fc.oneof(anyText, vocabCommand), { maxLength: 30 }), (seed, lines) => {
        const env = makeEnv();
        let state = start(newGame(seed), env).state;
        for (const line of lines) {
          const r = step(state, line, env);
          expect(r.state).toBeDefined();
          state = r.state;
        }
      }),
      { numRuns: 100, verbose: 1 },
    );
  });
});
