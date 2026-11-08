// Feature: game-engine, Property 2: RNG output ranges
// **Validates: Requirements 2.5, 2.6, 16.5**
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { randrange, setSeed } from '../../src/engine/rng';

const int32 = fc.integer({ min: -2147483648, max: 2147483647 });

describe('Property 2: RNG output ranges', () => {
  it('randrange(n) is an integer in [0, n-1] for n in 1..2048', () => {
    fc.assert(
      fc.property(int32, fc.integer({ min: 1, max: 2048 }), (seed, n) => {
        const game = { lcg_x: 0, zzword: '' };
        setSeed(game, seed);
        const v = randrange(game, n);
        return Number.isInteger(v) && v >= 0 && v <= n - 1;
      }),
      { numRuns: 500 },
    );
  });

  it('randrange stays in range over repeated draws from any valid lcg_x', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1048575 }),
        fc.integer({ min: 1, max: 2048 }),
        (x, n) => {
          const game = { lcg_x: x };
          for (let i = 0; i < 20; i++) {
            const v = randrange(game, n);
            if (!Number.isInteger(v) || v < 0 || v >= n) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('set_seed yields a 5-char zzword (letter, apostrophe, 3 letters) and lcg_x in [0, 1048575]', () => {
    fc.assert(
      fc.property(int32, (seed) => {
        const game = { lcg_x: 0, zzword: '' };
        setSeed(game, seed);
        return (
          game.zzword.length === 5 &&
          /^[A-Z]'[A-Z]{3}$/.test(game.zzword) &&
          Number.isInteger(game.lcg_x) &&
          game.lcg_x >= 0 &&
          game.lcg_x <= 1048575
        );
      }),
      { numRuns: 500 },
    );
  });

  it('covers int32 extremes', () => {
    for (const seed of [-2147483648, -1, 0, 1, 2147483647]) {
      const game = { lcg_x: 0, zzword: '' };
      setSeed(game, seed);
      expect(game.zzword).toMatch(/^[A-Z]'[A-Z]{3}$/);
      expect(game.lcg_x).toBeGreaterThanOrEqual(0);
      expect(game.lcg_x).toBeLessThanOrEqual(1048575);
    }
  });
});
