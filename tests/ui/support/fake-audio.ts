// Recording fake AudioContext for ghost chain / Ghost_Voice tests. No audio device.
import type { VoiceContextLike } from '../../../src/ui/dom/ghost-voice';

export class FakeNode {
  targets: unknown[] = [];
  connect(dest: unknown): unknown {
    this.targets.push(dest);
    return dest;
  }
  disconnect(): void {
    this.targets = [];
  }
}

export class FakeGain extends FakeNode {
  gain = {
    value: 1,
    ramps: [] as Array<[number, number]>,
    setValueAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime(v: number, t: number) {
      this.ramps.push([v, t]);
    },
  };
}
export class FakeFilter extends FakeNode {
  type = '';
  frequency = { value: 0 };
}
export class FakeDelay extends FakeNode {
  delayTime = { value: 0 };
}
export class FakeConvolver extends FakeNode {
  buffer: unknown = null;
}
export class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  stopAt: number | undefined;
  start(): void {
    this.started++;
  }
  stop(when?: number): void {
    this.stopped++;
    this.stopAt = when;
  }
  /** Simulates natural end. */
  finish(): void {
    this.onended?.();
  }
}

export class FakeAudioContext implements VoiceContextLike {
  destination = { name: 'destination' };
  sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  resumed = 0;
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  delays: FakeDelay[] = [];
  convolvers: FakeConvolver[] = [];
  compressors: FakeNode[] = [];
  sources: FakeSource[] = [];
  buffers: Array<{ channels: number; length: number; data: Float32Array[]; getChannelData(c: number): Float32Array }> = [];
  decodeFails = false;
  decoded: ArrayBuffer[] = [];

  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createDelay(): FakeDelay {
    const d = new FakeDelay();
    this.delays.push(d);
    return d;
  }
  createConvolver(): FakeConvolver {
    const c = new FakeConvolver();
    this.convolvers.push(c);
    return c;
  }
  createDynamicsCompressor(): FakeNode {
    const c = new FakeNode();
    this.compressors.push(c);
    return c;
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const b = { channels, length, data, getChannelData: (c: number) => data[c]! };
    this.buffers.push(b);
    return b;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    if (this.decodeFails) throw new Error('decode');
    this.decoded.push(data);
    return { decoded: true };
  }
  async resume(): Promise<void> {
    this.resumed++;
  }
}
