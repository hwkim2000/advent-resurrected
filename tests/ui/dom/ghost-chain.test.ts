import { describe, expect, it } from 'vitest';
import {
  GHOST_ECHO_DELAY_S,
  GHOST_ECHO_FEEDBACK,
  GHOST_MASTER_GAIN,
  GHOST_PLAYBACK_RATE,
  GHOST_REVERB_SECONDS,
  buildGhostChain,
} from '../../../src/ui/dom/ghost-chain';
import { FakeAudioContext } from '../support/fake-audio';

describe('ghost chain', () => {
  it('uses the designed parameters', () => {
    const ctx = new FakeAudioContext();
    buildGhostChain(ctx);
    expect(GHOST_PLAYBACK_RATE).toBe(0.92);
    const hp = ctx.filters.find((f) => f.type === 'highpass')!;
    expect(hp.frequency.value).toBe(80);
    const lp = ctx.filters.find((f) => f.type === 'lowpass')!;
    expect(lp.frequency.value).toBe(2500);
    expect(ctx.delays[0]!.delayTime.value).toBe(GHOST_ECHO_DELAY_S);
    expect(GHOST_ECHO_DELAY_S).toBe(0.19);
    const gains = ctx.gains.map((g) => g.gain.value);
    expect(gains).toEqual(expect.arrayContaining([0.8, GHOST_ECHO_FEEDBACK, 0.35, 0.3, GHOST_MASTER_GAIN]));
    expect(GHOST_MASTER_GAIN).toBe(0.7);
    const imp = ctx.buffers[0]!;
    expect(imp.channels).toBe(2);
    expect(imp.length).toBe(Math.floor(ctx.sampleRate * GHOST_REVERB_SECONDS));
    expect(ctx.convolvers[0]!.buffer).not.toBeNull();
  });

  it('connects input -> (dry, echo, reverb) -> compressor -> master -> destination', () => {
    const ctx = new FakeAudioContext();
    const chain = buildGhostChain(ctx);
    const hp = ctx.filters.find((f) => f.type === 'highpass')!;
    expect(chain.input).toBe(hp);
    const comp = ctx.compressors[0]!;
    expect(hp.targets).toContain(ctx.delays[0]);
    expect(hp.targets).toContain(ctx.convolvers[0]);
    expect(comp.targets.length).toBe(1);
    const master = comp.targets[0] as { targets: unknown[] };
    expect(master.targets).toContain(ctx.destination);
    // feedback loop exists
    const feedback = ctx.gains.find((g) => g.gain.value === GHOST_ECHO_FEEDBACK)!;
    expect(feedback.targets).toContain(ctx.delays[0]);
  });

  it('impulse is decaying and finite', () => {
    const ctx = new FakeAudioContext();
    buildGhostChain(ctx);
    const d = ctx.buffers[0]!.data[0]!;
    expect(d.every(Number.isFinite)).toBe(true);
    const head = d.slice(0, 2000).reduce((a, v) => a + Math.abs(v), 0);
    const tail = d.slice(-2000).reduce((a, v) => a + Math.abs(v), 0);
    expect(tail).toBeLessThan(head);
  });
});
