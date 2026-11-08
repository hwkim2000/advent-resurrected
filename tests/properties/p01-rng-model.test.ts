/*
 * Property 1: RNG matches the C formulas.
 * Validates: Requirements 2.1, 2.2, 2.5
 *
 * Compares src/engine/rng.ts against an independent BigInt model of misc.c
 * (set_seed, get_next_lcg_value, randrange) and the PCT macro from advent.h.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { pct, randrange, setSeed } from '../../src/engine/rng';

const M = 1048576n;

/** Independent BigInt model of the C RNG. */
class Model {
  x = 0n;
  zz = '';
  next(): bigint {
    const old = this.x;
    this.x = (1093n * this.x + 221587n) % M;
    return old;
  }
  randrange(r: number): number {
    const v = BigInt.asIntN(32, BigInt(r) * this.next());
    return Number(v / M); // BigInt division truncates like C
  }
  pct(n: number): boolean {
    return this.randrange(100) < n;
  }
  setSeed(seed: number): void {
    let x = BigInt(seed) % M; // BigInt % truncates like C
    if (x < 0n) x += M;
    this.x = x;
    const c: string[] = [];
    for (let i = 0; i < 5; i++) c.push(String.fromCharCode(65 + this.randrange(26)));
    c[1] = "'";
    this.zz = c.join('');
  }
}

type Op =
  | { k: 'seed'; seed: number }
  | { k: 'range'; n: number }
  | { k: 'pct'; n: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant('seed' as const), seed: fc.integer({ min: -2147483648, max: 2147483647 }) }),
  fc.record({ k: fc.constant('range' as const), n: fc.integer({ min: 1, max: 2048 }) }),
  fc.record({ k: fc.constant('pct' as const), n: fc.integer({ min: 0, max: 100 }) }),
);

describe('Property 1: RNG matches the C formulas', () => {
  it('agrees with the BigInt model over arbitrary op sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.array(opArb, { maxLength: 60 }),
        (seed0, ops) => {
          const game = { lcg_x: 0, zzword: '' };
          const model = new Model();
          setSeed(game, seed0);
          model.setSeed(seed0);
          expect(game.lcg_x).toBe(Number(model.x));
          expect(game.zzword).toBe(model.zz);
          for (const op of ops) {
            if (op.k === 'seed') {
              setSeed(game, op.seed);
              model.setSeed(op.seed);
            } else if (op.k === 'range') {
              expect(randrange(game, op.n)).toBe(model.randrange(op.n));
            } else {
              expect(pct(game, op.n)).toBe(model.pct(op.n));
            }
            expect(game.lcg_x).toBe(Number(model.x));
            expect(game.zzword).toBe(model.zz);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // Hand-computed from the C formulas: x' = (1093x + 221587) mod 1048576,
  // draw = floor(26 * old_x / 1048576), 'A' + draw, index 1 forced to '.
  // Seed 0: x = 0 -> 'A'; x = 221587 -> floor(26*221587/1048576) = 5 -> 'F' (then forced to ').
  // Seed -5: -5 % M = -5, +M = 1048571 -> 26*1048571/M = 25 -> 'Z'.
  it.each([
    { seed: 0, lcgX: 419063, zz: "A'EPW" },
    { seed: 1, lcgX: 291436, zz: "A'IWS" },
    { seed: -5, lcgX: 8622, zz: "Z'MHP" },
  ])('set_seed($seed) yields known lcg_x and zzword', ({ seed, lcgX, zz }) => {
    const game = { lcg_x: 0, zzword: '' };
    setSeed(game, seed);
    expect(game.lcg_x).toBe(lcgX);
    expect(game.zzword).toBe(zz);
  });
});
