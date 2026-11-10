// @vitest-environment happy-dom
// Haunting task 4.1: DOM effects (dim property, "all haunted" flash, reincarnation flicker).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLICKER_CLASS, FLICKER_MS, GLITCH_MS, createHauntEffects } from '../../../src/ui/dom/haunt-effects';
import { FakeMotion } from '../support/fakes';

const ORIGINAL = 'You are in a maze of twisty little passages, all alike.';

function setupDom(): void {
  document.body.innerHTML = '';
  const crt = document.createElement('div');
  crt.className = 'crt';
  const tr = document.createElement('div');
  tr.id = 'transcript';
  for (const [kind, text] of [
    ['original', ORIGINAL],
    ['input', '> east'],
    ['original', 'Somewhere else.'],
  ] as const) {
    const line = document.createElement('div');
    line.className = `line line--${kind}`;
    line.appendChild(document.createTextNode(text));
    tr.appendChild(line);
  }
  crt.appendChild(tr);
  document.body.appendChild(crt);
}

const alikeNode = (): Text => document.querySelector('#transcript .line--original')!.firstChild as Text;

describe('haunt effects', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    document.documentElement.style.removeProperty('--haunt-dim');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('setDim writes --haunt-dim on the document element; reset removes it', () => {
    const fx = createHauntEffects({ motion: new FakeMotion(false) });
    fx.setDim(0.75);
    expect(document.documentElement.style.getPropertyValue('--haunt-dim')).toBe('0.75');
    fx.reset();
    expect(document.documentElement.style.getPropertyValue('--haunt-dim')).toBe('');
  });

  it('flashGlitch swaps the text for 1000 ms and restores the exact string', () => {
    const fx = createHauntEffects({ motion: new FakeMotion(false) });
    fx.flashGlitch();
    expect(alikeNode().data).toBe('You are in a maze of twisty little passages, all haunted.');
    vi.advanceTimersByTime(GLITCH_MS - 1);
    expect(alikeNode().data).toContain('all haunted');
    vi.advanceTimersByTime(1);
    expect(alikeNode().data).toBe(ORIGINAL);
  });

  it('does not overwrite text that changed while glitched', () => {
    const fx = createHauntEffects({ motion: new FakeMotion(false) });
    fx.flashGlitch();
    alikeNode().data = 'something else entirely';
    vi.advanceTimersByTime(GLITCH_MS);
    expect(alikeNode().data).toBe('something else entirely');
  });

  it('skips the glitch and the flicker under reduced motion', () => {
    const fx = createHauntEffects({ motion: new FakeMotion(true) });
    fx.flashGlitch();
    fx.reincarnate();
    expect(alikeNode().data).toBe(ORIGINAL);
    expect(document.querySelector('.crt')!.classList.contains(FLICKER_CLASS)).toBe(false);
  });

  it('reincarnate flickers for about 1.2 s and survives a missing AudioContext', () => {
    const fx = createHauntEffects({ motion: new FakeMotion(false) });
    const crt = document.querySelector('.crt')!;
    fx.reincarnate();
    expect(crt.classList.contains(FLICKER_CLASS)).toBe(true);
    vi.advanceTimersByTime(FLICKER_MS);
    expect(crt.classList.contains(FLICKER_CLASS)).toBe(false);
  });

  it.each(['keydown', 'pointerdown'])('a %s cancels the flicker', (type) => {
    const fx = createHauntEffects({ motion: new FakeMotion(false) });
    const crt = document.querySelector('.crt')!;
    fx.reincarnate();
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
    expect(crt.classList.contains(FLICKER_CLASS)).toBe(false);
  });

  it('a throwing AudioContext does not stop the flicker', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    g.AudioContext = class {
      constructor() {
        throw new Error('no audio');
      }
    };
    try {
      const fx = createHauntEffects({ motion: new FakeMotion(false) });
      fx.reincarnate();
      expect(document.querySelector('.crt')!.classList.contains(FLICKER_CLASS)).toBe(true);
    } finally {
      delete g.AudioContext;
    }
  });
});

describe('haunt CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/ui/crt.css'), 'utf8');

  it('scopes the dim filter to Haunted games and defines the flicker', () => {
    expect(css).toMatch(/html\[data-game-mode="haunted"\] \.crt\s*\{[^}]*brightness\(var\(--haunt-dim, 1\)\)/);
    expect(css).toContain('@keyframes haunt-flicker');
  });

  it('disables the flicker and the dim transition under reduced motion', () => {
    const reduced = css.slice(css.indexOf('/* ---------- Reduced motion ---------- */'));
    expect(reduced).toMatch(/\.crt\.haunt-flicker\s*\{\s*animation:\s*none !important/);
    expect(reduced).toMatch(/data-game-mode="haunted"\] \.crt\s*\{\s*transition:\s*none !important/);
  });
});
