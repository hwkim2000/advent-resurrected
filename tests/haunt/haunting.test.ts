// Haunting task 4.4: the assembled haunting layer through the real GameController.
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/engine/index';
import { dimLevel } from '../../src/haunt/dim';
import { HAUNT_CHUNK_MARKER, createHaunting } from '../../src/haunt/haunting';
import type { HauntEffectsPort } from '../../src/haunt/haunting';
import { REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { decodeAutosave } from '../../src/ui/autosave';
import { AUTOSAVE_KEY } from '../../src/ui/save-store';
import { FakeMotion, makeController } from '../ui/support/fakes';
import type { MadeController } from '../ui/support/fakes';
import { logLines } from './support';

class FakeEffects implements HauntEffectsPort {
  dims: number[] = [];
  glitches = 0;
  reincarnations = 0;
  resets = 0;
  setDim(level: number): void {
    this.dims.push(level);
  }
  flashGlitch(): void {
    this.glitches += 1;
  }
  reincarnate(): void {
    this.reincarnations += 1;
  }
  reset(): void {
    this.resets += 1;
  }
}

class ThrowingEffects implements HauntEffectsPort {
  setDim(): void {
    throw new Error('dim');
  }
  flashGlitch(): void {
    throw new Error('glitch');
  }
  reincarnate(): void {
    throw new Error('reincarnate');
  }
  reset(): void {
    throw new Error('reset');
  }
}

function say(m: MadeController, line: string): void {
  m.controller.submit(line);
  m.controller.tick(0);
}

function setup(effects: HauntEffectsPort | undefined): MadeController {
  const m = makeController({ mode: 'haunted' });
  if (effects !== undefined) {
    createHaunting({ hooks: m.hooks, effects, motion: new FakeMotion(false), seed: 7, getState: () => m.controller.engineState }).gameStart(
      m.controller.engineState,
    );
  }
  return m;
}

const REINCARNATE = logLines('reincarnate');
while (REINCARNATE[REINCARNATE.length - 1] === '') REINCARNATE.pop();

function play(m: MadeController, lines: readonly string[]): void {
  for (const l of lines) say(m, l);
}

const original = (m: MadeController) => m.view.textOfKind('original');
const savedLines = (m: MadeController) =>
  decodeAutosave(m.kv.get(AUTOSAVE_KEY))?.lines.map((l) => `${l.kind}:${l.text}`) ?? [];
const originalLines = (m: MadeController) => savedLines(m).filter((l) => l.startsWith('original:'));

describe('haunting assembly', () => {
  it('exports a distinctive chunk marker', () => {
    expect(typeof HAUNT_CHUNK_MARKER).toBe('string');
    expect(HAUNT_CHUNK_MARKER.length).toBeGreaterThan(12);
  });

  it('adds narrator blocks after the original text and leaves the original text identical', () => {
    const plain = setup(undefined);
    const haunted = setup(new FakeEffects());
    play(plain, REINCARNATE);
    play(haunted, REINCARNATE);

    expect(original(haunted)).toBe(original(plain));
    expect(originalLines(haunted)).toEqual(originalLines(plain));
    expect(plain.view.textOfKind('narrator')).toBe('');

    const kinds = haunted.view.blocks.map((b) => b.kind);
    expect(kinds).toContain('narrator');
    kinds.forEach((k, i) => {
      if (k === 'narrator') expect(kinds.slice(0, i)).toContain('original');
    });
    // A narrator block never replaces original text: the block before the first one is original.
    const first = kinds.indexOf('narrator');
    expect(kinds[first - 1]).toBe('original');
  });

  it('triggers one reincarnation effect and a narrator countdown block', () => {
    const fx = new FakeEffects();
    const m = setup(fx);
    play(m, REINCARNATE.slice(0, -1));
    expect(fx.reincarnations).toBe(0);
    say(m, 'y');
    expect(fx.reincarnations).toBe(1);
    expect(m.view.textOfKind('narrator')).toContain(REINCARNATION_COUNTDOWN);
    say(m, 'look');
    expect(fx.reincarnations).toBe(1);
  });

  it('sets the dim level from the engine state every turn, following the lamp limit', () => {
    const fx = new FakeEffects();
    const m = setup(fx);
    expect(fx.dims).toEqual([1]); // gameStart syncs once
    play(m, ['n', 'in', 'take lamp', 'light lamp']);
    for (let i = 0; i < 200; i++) say(m, i % 2 === 0 ? 'out' : 'in');
    const last = fx.dims[fx.dims.length - 1]!;
    expect(last).toBe(dimLevel(m.controller.engineState!.game));
    expect(last).toBeLessThan(1);
    expect(last).toBeGreaterThanOrEqual(0.6);
    for (let i = 1; i < fx.dims.length; i++) expect(fx.dims[i]!).toBeLessThanOrEqual(fx.dims[i - 1]!);
  });

  it('fires the glitch on the "all alike" block and leaves the transcript text unchanged', () => {
    const fx = new FakeEffects();
    const plain = setup(undefined);
    const m = setup(fx);
    const lines = logLines('endobjects');
    for (const l of lines) {
      say(plain, l);
      say(m, l);
      if (original(m).includes('all alike')) break;
    }
    expect(original(m)).toContain('all alike');
    expect(fx.glitches).toBe(1);
    expect(original(m)).toBe(original(plain));
    expect(original(m)).not.toContain('all haunted');
    expect(savedLines(m).join('\n')).not.toContain('all haunted');
  });

  it('leaves the game playable and identical when the effects throw', () => {
    const plain = setup(undefined);
    const broken = setup(new ThrowingEffects());
    play(plain, REINCARNATE);
    play(broken, REINCARNATE);
    expect(serialize(broken.controller.engineState!)).toBe(serialize(plain.controller.engineState!));
    expect(original(broken)).toBe(original(plain));
    expect(broken.controller.phase).toBe('ready');
    expect(broken.view.textOfKind('narrator')).not.toBe('');
    say(broken, 'look');
    expect(broken.controller.phase).toBe('ready');
  });

  it('dispose unregisters the hooks and resets the effects', () => {
    const fx = new FakeEffects();
    const m = makeController({ mode: 'haunted' });
    const h = createHaunting({ hooks: m.hooks, effects: fx, motion: new FakeMotion(false), seed: 1, getState: () => m.controller.engineState });
    h.gameStart(m.controller.engineState);
    h.dispose();
    expect(fx.resets).toBe(1);
    const dims = fx.dims.length;
    play(m, REINCARNATE);
    expect(fx.dims.length).toBe(dims);
    expect(fx.reincarnations).toBe(0);
    expect(m.view.textOfKind('narrator')).toBe('');
  });

  it('shows no narrator and calls no effects in 1976 mode', () => {
    const fx = new FakeEffects();
    const m = makeController({ mode: '1976' });
    createHaunting({ hooks: m.hooks, effects: fx, motion: new FakeMotion(false), seed: 1, getState: () => m.controller.engineState }).gameStart(
      m.controller.engineState,
    );
    fx.dims.length = 0;
    play(m, REINCARNATE);
    expect(fx.dims).toEqual([]);
    expect(fx.reincarnations).toBe(0);
    expect(fx.glitches).toBe(0);
    expect(m.view.textOfKind('narrator')).toBe('');
  });
});
