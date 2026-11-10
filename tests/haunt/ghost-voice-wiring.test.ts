// ghost-voice task 5.2: narrator output -> effects.speak, stop triggers, safety.
import { describe, expect, it } from 'vitest';
import { createHaunting } from '../../src/haunt/haunting';
import type { HauntEffectsPort } from '../../src/haunt/haunting';
import { REINCARNATION_COUNTDOWN } from '../../src/haunt/lines';
import { voiceKey } from '../../src/haunt/voice-lines';
import { FakeMotion, makeController } from '../ui/support/fakes';
import type { MadeController } from '../ui/support/fakes';
import { logLines } from './support';

class VoiceEffects implements HauntEffectsPort {
  spoken: { key: string; text: string }[] = [];
  stops = 0;
  resets = 0;
  setDim(): void {}
  flashGlitch(): void {}
  reincarnate(): void {}
  reset(): void {
    this.resets += 1;
  }
  speak(item: { key: string; text: string }): void {
    this.spoken.push(item);
  }
  stopSpeaking(): void {
    this.stops += 1;
  }
}

class ThrowingVoiceEffects extends VoiceEffects {
  override speak(): void {
    throw new Error('speak');
  }
  override stopSpeaking(): void {
    throw new Error('stop');
  }
}

function setup(effects: HauntEffectsPort): { m: MadeController; h: ReturnType<typeof createHaunting> } {
  const m = makeController({ mode: 'haunted' });
  const h = createHaunting({ hooks: m.hooks, effects, motion: new FakeMotion(false), seed: 7, getState: () => m.controller.engineState });
  h.gameStart(m.controller.engineState);
  return { m, h };
}

function say(m: MadeController, line: string): void {
  m.controller.submit(line);
  m.controller.tick(0);
}

const REINCARNATE = logLines('reincarnate');
while (REINCARNATE[REINCARNATE.length - 1] === '') REINCARNATE.pop();

function play(m: MadeController, lines: readonly string[]): void {
  for (const l of lines) say(m, l);
}

describe('ghost voice wiring in haunting', () => {
  it('speaks each revealed narrator block once with the matching key, and nothing else', () => {
    const fx = new VoiceEffects();
    const { m } = setup(fx);
    play(m, REINCARNATE);
    const narratorBlocks = m.view.blocks.filter((b) => b.kind === 'narrator');
    expect(narratorBlocks.length).toBeGreaterThan(0);
    expect(fx.spoken).toHaveLength(narratorBlocks.length);
    for (const s of fx.spoken) {
      expect(s.key).toBe(voiceKey(s.text));
      expect(s.text).toBe(s.text.trim());
    }
    expect(fx.spoken.map((s) => s.text)).toContain(REINCARNATION_COUNTDOWN);
  });

  it('stops speaking on submit, on game start and on dispose', () => {
    const fx = new VoiceEffects();
    const { m, h } = setup(fx);
    const afterStart = fx.stops;
    expect(afterStart).toBeGreaterThan(0); // gameStart
    say(m, 'look');
    expect(fx.stops).toBeGreaterThan(afterStart); // transformer on submit
    const before = fx.stops;
    h.dispose();
    expect(fx.stops).toBe(before + 1);
    expect(fx.resets).toBe(1);
  });

  it('keeps the game playable when speak and stopSpeaking throw', () => {
    const plain = setup(new VoiceEffects());
    const bad = setup(new ThrowingVoiceEffects());
    play(plain.m, REINCARNATE);
    play(bad.m, REINCARNATE);
    expect(bad.m.view.textOfKind('original')).toBe(plain.m.view.textOfKind('original'));
    expect(bad.m.view.textOfKind('narrator')).toBe(plain.m.view.textOfKind('narrator'));
    expect(() => bad.h.dispose()).not.toThrow();
  });

  it('does not speak after dispose', () => {
    const fx = new VoiceEffects();
    const { m, h } = setup(fx);
    h.dispose();
    const n = fx.spoken.length;
    play(m, REINCARNATE);
    expect(fx.spoken).toHaveLength(n);
  });
});
