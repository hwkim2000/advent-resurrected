// Feature: game-engine, Property 22: Score bounds and purity
// **Validates: Requirements 10.3, 10.6, 12.5, 16.2**
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cloneState, newGame, start, step } from '../../src/engine';
import { computeScore } from '../../src/engine/score';
import type { Termination } from '../../src/engine/score';
import {
  PBT_CONFIG,
  makeEnv,
  reachableState,
  seedArb,
  vocabCommand,
} from '../support/generators';

const MODES: Termination[] = ['scoregame', 'quitgame', 'endgame'];

describe('Property 22: Score bounds and purity', () => {
  it('score is an integer in [0, 430] after every step of up to 100 commands from a new game (C-3)', () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.array(vocabCommand, {
          minLength: 1,
          maxLength: 100,
        }),
        (seed, commands) => {
          const env = makeEnv();
          let state = start(newGame(seed), env).state;
          const check = (): void => {
            const { score } = computeScore(state.game, 'scoregame');
            expect(Number.isInteger(score)).toBe(true);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(430);
          };
          check();
          for (const line of commands) {
            if (state.session.status === 'over') break;
            state = step(state, line, env).state;
            check();
          }
        },
      ),
      PBT_CONFIG as fc.Parameters<[number, string[]]>,
    );
  });

  it('upper bound 430 holds for every reachable state and every mode', () => {
    fc.assert(
      fc.property(reachableState, (state) => {
        for (const mode of MODES) {
          const { score } = computeScore(state.game, mode);
          expect(Number.isInteger(score)).toBe(true);
          expect(score).toBeLessThanOrEqual(430);
        }
      }),
      PBT_CONFIG as fc.Parameters<[ReturnType<typeof newGame>]>,
    );
  });

  it('computeScore is pure: repeated calls agree and leave the state deeply equal', () => {
    fc.assert(
      fc.property(reachableState, (state) => {
        const before = cloneState(state);
        for (const mode of MODES) {
          const a = computeScore(state.game, mode);
          const b = computeScore(state.game, mode);
          expect(b).toEqual(a);
        }
        expect(state).toEqual(before);
      }),
      PBT_CONFIG as fc.Parameters<[ReturnType<typeof newGame>]>,
    );
  });
});
