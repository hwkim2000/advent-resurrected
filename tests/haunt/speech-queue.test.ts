import { describe, expect, it } from 'vitest';
import { MAX_WAIT_MS, createSpeechQueue } from '../../src/haunt/speech-queue';
import type { SpeechPlayer } from '../../src/haunt/speech-queue';

function setup() {
  const played: string[] = [];
  const ends: Array<() => void> = [];
  let stops = 0;
  let t = 0;
  const player: SpeechPlayer<string> = {
    play(item, onEnd) {
      played.push(item);
      ends.push(onEnd);
    },
    stop() {
      stops++;
    },
  };
  const q = createSpeechQueue<string>({ player, now: () => t });
  return { q, played, ends, stops: () => stops, advance: (ms: number) => (t += ms) };
}

describe('speech queue', () => {
  it('plays immediately when idle', () => {
    const s = setup();
    s.q.offer('a');
    expect(s.played).toEqual(['a']);
    expect(s.q.isPlaying()).toBe(true);
  });

  it('keeps one waiting item; a newer one replaces it', () => {
    const s = setup();
    s.q.offer('a');
    s.q.offer('b');
    s.q.offer('c');
    expect(s.played).toEqual(['a']);
    s.ends[0]!();
    expect(s.played).toEqual(['a', 'c']);
  });

  it('promotes the waiting item at end of play, then goes idle', () => {
    const s = setup();
    s.q.offer('a');
    s.q.offer('b');
    s.ends[0]!();
    s.ends[1]!();
    expect(s.q.isPlaying()).toBe(false);
    expect(s.q.hasWaiting()).toBe(false);
  });

  it('drops a waiting item older than 8 s', () => {
    const s = setup();
    s.q.offer('a');
    s.q.offer('b');
    s.advance(MAX_WAIT_MS + 1);
    s.ends[0]!();
    expect(s.played).toEqual(['a']);
    expect(s.q.isPlaying()).toBe(false);
  });

  it('keeps a waiting item at exactly 8 s', () => {
    const s = setup();
    s.q.offer('a');
    s.q.offer('b');
    s.advance(MAX_WAIT_MS);
    s.ends[0]!();
    expect(s.played).toEqual(['a', 'b']);
  });

  it('cancel stops the player, clears waiting and ignores the stale end', () => {
    const s = setup();
    s.q.offer('a');
    s.q.offer('b');
    s.q.cancel();
    expect(s.stops()).toBe(1);
    s.ends[0]!();
    expect(s.played).toEqual(['a']);
    expect(s.q.isPlaying()).toBe(false);
    s.q.offer('c');
    expect(s.played).toEqual(['a', 'c']);
  });

  it('cancel when idle does not call stop', () => {
    const s = setup();
    s.q.cancel();
    expect(s.stops()).toBe(0);
  });

  it('a player that throws does not wedge the queue', () => {
    const q = createSpeechQueue<string>({
      player: {
        play() {
          throw new Error('boom');
        },
        stop() {},
      },
      now: () => 0,
    });
    q.offer('a');
    expect(q.isPlaying()).toBe(false);
  });
});
