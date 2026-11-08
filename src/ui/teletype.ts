// Teletype printer: a pure, tick-driven scheduler that reveals text blocks
// character by character. It owns no timers; callers feed it time through
// `enqueue(block, nowMs)` and `tick(nowMs)`. Pauses are data, not timeouts.

import type { BlockMeta, LineKind, Speed } from './types';

export type { BlockMeta } from './types';

export interface TeletypeBlock {
  kind: LineKind;
  text: string;
  /** Per-block rate override in characters per second (boot uses 30). */
  cps?: number | 'instant';
  /** Pause after this block; honoured only when animating and a block follows. */
  pauseAfterMs?: number;
}

export interface TeletypeSink {
  begin(b: BlockMeta): void;
  write(id: number, chunk: string): void;
  end(b: BlockMeta): void;
}

export interface TeletypeOptions {
  /** Current Typing_Speed; read on every tick. */
  speed(): Speed;
  /** Reduced_Motion_Preference; read on every tick. */
  reduced(): boolean;
  sink: TeletypeSink;
  /** Called with the full block after its last chunk. */
  onRevealed(b: BlockMeta): void;
  /** Called when the queue becomes empty. */
  onIdle(): void;
}

interface Item {
  meta: BlockMeta;
  chars: string[]; // code points
  pos: number;
  begun: boolean;
  cps: number | 'instant' | undefined;
  pauseAfterMs: number;
}

export class Teletype {
  private readonly opts: TeletypeOptions;
  private readonly queue: Item[] = [];
  private nextId = 1;
  private last = 0;
  private budget = 0;
  private pauseRemaining = 0;

  constructor(opts: TeletypeOptions) {
    this.opts = opts;
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  enqueue(block: TeletypeBlock, nowMs: number): void {
    const meta: BlockMeta = { id: this.nextId++, kind: block.kind, text: block.text };
    const item: Item = {
      meta,
      chars: Array.from(block.text),
      pos: 0,
      begun: false,
      cps: block.cps,
      pauseAfterMs: block.pauseAfterMs ?? 0,
    };
    const wasEmpty = this.queue.length === 0;
    this.queue.push(item);
    if (wasEmpty) {
      this.last = nowMs;
      this.budget = 0;
      this.pauseRemaining = 0;
    }
    // An instant block at the head of an empty queue is revealed before returning.
    if (wasEmpty && this.rateOf(item) === 'instant') {
      this.drain(0);
    }
  }

  tick(nowMs: number): void {
    if (this.queue.length === 0) {
      this.last = nowMs;
      return;
    }
    const dt = Math.max(0, nowMs - this.last);
    this.last = nowMs;
    this.drain(dt);
  }

  flush(): void {
    if (this.queue.length === 0) return;
    while (this.queue.length > 0) {
      const item = this.queue[0]!;
      this.begin(item);
      this.writeUpTo(item, item.chars.length);
      this.finish(item);
    }
    this.budget = 0;
    this.pauseRemaining = 0;
    this.opts.onIdle();
  }

  private rateOf(item: Item): number | 'instant' {
    if (this.opts.reduced()) return 'instant';
    const r = item.cps ?? this.opts.speed();
    if (r === 'instant' || !(r > 0)) return 'instant';
    return r;
  }

  private begin(item: Item): void {
    if (item.begun) return;
    item.begun = true;
    this.opts.sink.begin(item.meta);
  }

  private writeUpTo(item: Item, upTo: number): void {
    if (upTo > item.pos) {
      this.opts.sink.write(item.meta.id, item.chars.slice(item.pos, upTo).join(''));
      item.pos = upTo;
    }
  }

  /** Ends the head item, removes it from the queue and reports it. */
  private finish(item: Item): void {
    this.queue.shift();
    this.opts.sink.end(item.meta);
    this.opts.onRevealed(item.meta);
  }

  /** Spends `dt` ms of tick time on the queue. */
  private drain(dtIn: number): void {
    let dt = dtIn;
    let didFinish = false;
    while (this.queue.length > 0) {
      const item = this.queue[0]!;

      if (this.pauseRemaining > 0) {
        if (this.rateOf(item) === 'instant') {
          this.pauseRemaining = 0;
        } else if (dt >= this.pauseRemaining) {
          dt -= this.pauseRemaining;
          this.pauseRemaining = 0;
        } else {
          this.pauseRemaining -= dt;
          dt = 0;
          break;
        }
      }

      this.begin(item);
      const rate = this.rateOf(item);
      const total = item.chars.length;
      let done = false;
      if (rate === 'instant') {
        done = true;
      } else {
        const available = this.budget + (dt * rate) / 1000;
        const needed = total - item.pos;
        if (available >= needed) {
          // Time actually used to finish this block; carry the rest.
          const used = ((needed - this.budget) * 1000) / rate;
          dt = Math.max(0, dt - Math.max(0, used));
          done = true;
        } else {
          const whole = Math.floor(available);
          this.writeUpTo(item, item.pos + whole);
          this.budget = available - whole;
          dt = 0;
        }
      }

      if (!done) break;
      this.writeUpTo(item, total);
      this.budget = 0;
      const pause = item.pauseAfterMs;
      const hasNext = this.queue.length > 1;
      this.finish(item);
      didFinish = true;
      // A callback may have enqueued more work; the queue is the source of truth.
      if (pause > 0 && this.queue.length > 0 && hasNext) {
        this.pauseRemaining = pause;
      }
    }
    if (didFinish && this.queue.length === 0) {
      this.budget = 0;
      this.pauseRemaining = 0;
      this.opts.onIdle();
    }
  }
}
