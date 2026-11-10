// Ghost effect chain for Ghost_Voice (Web Audio). Pitch-down comes from the
// source's playbackRate (set by the caller to GHOST_PLAYBACK_RATE); this file
// builds the rest: high-pass, dry/echo/reverb split, compressor, master gain.
//
//   input(high-pass 80 Hz) -> dry 0.8 ----------------------------> comp
//                          -> delay 0.19 s -> low-pass 2.5 kHz -> echo wet 0.35 -> comp
//                                   ^---- feedback 0.3 ----+
//                          -> convolver (generated 1.8 s impulse) -> reverb wet 0.3 -> comp
//   comp -> master 0.7 -> destination

export const GHOST_PLAYBACK_RATE = 0.92;
export const GHOST_HIGHPASS_HZ = 80;
export const GHOST_DRY_GAIN = 0.8;
export const GHOST_ECHO_DELAY_S = 0.19;
export const GHOST_ECHO_FEEDBACK = 0.3;
export const GHOST_ECHO_LOWPASS_HZ = 2500;
export const GHOST_ECHO_WET = 0.35;
export const GHOST_REVERB_SECONDS = 1.8;
export const GHOST_REVERB_WET = 0.3;
export const GHOST_MASTER_GAIN = 0.7;

export interface ParamLike {
  value: number;
}
export interface NodeLike {
  connect(dest: unknown): unknown;
  disconnect?(): void;
}
export interface GainLike extends NodeLike {
  gain: ParamLike & {
    setValueAtTime?(v: number, t: number): void;
    linearRampToValueAtTime?(v: number, t: number): void;
    cancelScheduledValues?(t: number): void;
  };
}
export interface BiquadLike extends NodeLike {
  type: string;
  frequency: ParamLike;
}
export interface DelayLike extends NodeLike {
  delayTime: ParamLike;
}
export interface ConvolverLike extends NodeLike {
  buffer: unknown;
}
export interface ChannelBufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface ChainContextLike {
  readonly destination: unknown;
  readonly sampleRate: number;
  createGain(): GainLike;
  createBiquadFilter(): BiquadLike;
  createDelay(maxDelayTime?: number): DelayLike;
  createConvolver(): ConvolverLike;
  createDynamicsCompressor(): NodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): ChannelBufferLike;
}

export interface GhostChain {
  /** Connect sources here. */
  readonly input: NodeLike;
}

/** Deterministic decaying noise, stereo. Built once per chain. */
export function buildImpulse(ctx: ChainContextLike): ChannelBufferLike {
  const rate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
  const length = Math.max(1, Math.floor(rate * GHOST_REVERB_SECONDS));
  const buf = ctx.createBuffer(2, length, rate);
  let seed = 0x9e3779b9;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = (seed >>> 8) / 0x800000 - 1;
      const decay = Math.pow(1 - i / length, 3);
      data[i] = noise * decay;
    }
  }
  return buf;
}

export function buildGhostChain(ctx: ChainContextLike): GhostChain {
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = GHOST_HIGHPASS_HZ;

  const dry = ctx.createGain();
  dry.gain.value = GHOST_DRY_GAIN;

  const delay = ctx.createDelay(1);
  delay.delayTime.value = GHOST_ECHO_DELAY_S;
  const echoLow = ctx.createBiquadFilter();
  echoLow.type = 'lowpass';
  echoLow.frequency.value = GHOST_ECHO_LOWPASS_HZ;
  const feedback = ctx.createGain();
  feedback.gain.value = GHOST_ECHO_FEEDBACK;
  const echoWet = ctx.createGain();
  echoWet.gain.value = GHOST_ECHO_WET;

  const convolver = ctx.createConvolver();
  convolver.buffer = buildImpulse(ctx);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = GHOST_REVERB_WET;

  const comp = ctx.createDynamicsCompressor();
  const master = ctx.createGain();
  master.gain.value = GHOST_MASTER_GAIN;

  highpass.connect(dry);
  dry.connect(comp);

  highpass.connect(delay);
  delay.connect(echoLow);
  echoLow.connect(feedback);
  feedback.connect(delay);
  echoLow.connect(echoWet);
  echoWet.connect(comp);

  highpass.connect(convolver);
  convolver.connect(reverbWet);
  reverbWet.connect(comp);

  comp.connect(master);
  master.connect(ctx.destination);

  return { input: highpass };
}
