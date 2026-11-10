import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LAMP, LAMP_BRIGHT, LAMP_DARK } from '../../src/data/constants';
import { newGame } from '../../src/engine';
import { DIM_FLOOR, DIM_START, dimLevel, dimLevelForLimit } from '../../src/haunt/dim';
import { GLITCH_EVERY, createGlitchPolicy } from '../../src/haunt/glitch';

function game(limit: number, lampOn: boolean) {
  const g = newGame(0).game;
  g.limit = limit;
  g.objects[LAMP]!.prop = lampOn ? LAMP_BRIGHT : LAMP_DARK;
  return g;
}

describe('dimLevel', () => {
  it('constants match the design', () => {
    expect(DIM_START).toBe(150);
    expect(DIM_FLOOR).toBe(0.6);
  });

  it('is 1 while the lamp is healthy or off', () => {
    expect(dimLevel(game(330, true))).toBe(1);
    expect(dimLevel(game(DIM_START + 1, true))).toBe(1);
    expect(dimLevel(game(DIM_START, true))).toBe(1);
    expect(dimLevel(game(100, false))).toBe(1);
    expect(dimLevel(game(1, false))).toBe(1);
  });

  it('reaches the floor when the battery is empty', () => {
    expect(dimLevel(game(0, true))).toBe(DIM_FLOOR);
    expect(dimLevel(game(-1, true))).toBe(DIM_FLOOR);
    expect(dimLevel(game(-1, false))).toBe(DIM_FLOOR);
  });

  it('stays within [0.6, 1] and never decreases as limit grows', () => {
    let prev = -Infinity;
    for (let limit = -5; limit <= 400; limit++) {
      const v = dimLevelForLimit(limit, true);
      expect(v).toBeGreaterThanOrEqual(DIM_FLOOR);
      expect(v).toBeLessThanOrEqual(1);
      if (limit >= 0) {
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('dims in the middle of the range', () => {
    const v = dimLevel(game(75, true));
    expect(v).toBeGreaterThan(DIM_FLOOR);
    expect(v).toBeLessThan(1);
    expect(v).toBeCloseTo(0.8, 5);
  });

  it('recovers after fresh batteries (limit += 2500)', () => {
    expect(dimLevel(game(10, true))).toBeLessThan(0.65);
    expect(dimLevel(game(10 + 2500, true))).toBe(1);
  });

  it('tolerates non-finite limits', () => {
    expect(dimLevelForLimit(Number.NaN, true)).toBe(1);
  });
});

describe('createGlitchPolicy', () => {
  it('glitches on visit 1, then every 4th', () => {
    const p = createGlitchPolicy();
    expect(GLITCH_EVERY).toBe(4);
    const fired = Array.from({ length: 12 }, () => p.visit());
    expect(fired).toEqual([
      true, false, false, false, true, false, false, false, true, false, false, false,
    ]);
  });

  it('reset starts the cadence again', () => {
    const p = createGlitchPolicy();
    p.visit();
    p.visit();
    p.reset();
    expect(p.visit()).toBe(true);
  });

  it('policies are independent', () => {
    const a = createGlitchPolicy();
    const b = createGlitchPolicy();
    a.visit();
    expect(b.visit()).toBe(true);
  });
});

// ---- contrast ----

const css = readFileSync(fileURLToPath(new URL('../../src/ui/crt.css', import.meta.url)), 'utf8');

function token(name: string): [number, number, number] {
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  expect(root).not.toBeNull();
  const m = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})\\s*;`).exec((root as RegExpExecArray)[1] as string);
  expect(m, `--${name} token`).not.toBeNull();
  const hex = (m as RegExpExecArray)[1] as string;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CSS brightness() scales sRGB channel values. */
const scale = (rgb: readonly number[], k: number): number[] => rgb.map((c) => c * k);

describe('contrast at the dim floor', () => {
  const bg = token('bg');

  for (const name of ['fg', 'narrator']) {
    it(`--${name} against --bg is at least 4.5:1 at brightness ${DIM_FLOOR}`, () => {
      const ratio = contrast(scale(token(name), DIM_FLOOR), scale(bg, DIM_FLOOR));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('full brightness is at least as good', () => {
    expect(contrast(token('fg'), bg)).toBeGreaterThan(contrast(scale(token('fg'), DIM_FLOOR), scale(bg, DIM_FLOOR)));
  });
});
