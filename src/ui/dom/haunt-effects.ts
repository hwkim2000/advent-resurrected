// DOM effects for Haunted mode: lamp dimming, the "all haunted" flash and the
// reincarnation flicker with a synthesized sting. Loaded lazily, never in 1976 mode.
// Timers live here (src/ui/dom is the only place allowed to use them). Text is
// changed only through Text node data; no innerHTML.

import type { KeyValueStore, Logger, MotionPreference } from '../types';
import { createGhostVoice } from './ghost-voice';
import type { CreateQueue, FetchResponseLike, GhostVoice, VoiceContextLike, VoiceItem } from './ghost-voice';

export interface HauntEffects {
  setDim(level: number): void;
  flashGlitch(): void;
  reincarnate(): void;
  reset(): void;
  /** Haunted game start: activates Ghost_Voice (no-op without kv and a queue factory). */
  start(): void;
  speak(item: VoiceItem): void;
  stopSpeaking(): void;
}

export interface HauntEffectsDeps {
  motion: MotionPreference;
  doc?: Document;
  /** Ghost_Voice needs all of kv and createQueue; without them it stays off. */
  kv?: KeyValueStore;
  createQueue?: CreateQueue;
  log?: Logger;
  fetchFn?: (url: string) => Promise<FetchResponseLike>;
  makeContext?: () => VoiceContextLike | undefined;
  now?: () => number;
}

export const GLITCH_MS = 1000;
export const FLICKER_MS = 1200;
export const FLICKER_CLASS = 'haunt-flicker';
export const DIM_PROPERTY = '--haunt-dim';

const ALIKE = /all alike/i;

interface AudioCtxLike {
  currentTime: number;
  destination: unknown;
  createOscillator(): {
    type: string;
    frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(n: unknown): void;
    start(t?: number): void;
    stop(t?: number): void;
    disconnect(): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void };
    connect(n: unknown): void;
  };
  resume?(): Promise<void>;
}

export function createHauntEffects(deps: HauntEffectsDeps): HauntEffects {
  const doc = deps.doc ?? document;
  const root = doc.documentElement;

  let glitch: { node: Text; original: string; glitched: string; timer: number } | undefined;
  let flicker: { el: Element; timer: number; stop: () => void } | undefined;
  let audio: AudioCtxLike | undefined;
  let audioFailed = false;

  function restoreGlitch(): void {
    const g = glitch;
    if (g === undefined) return;
    glitch = undefined;
    clearTimeout(g.timer);
    // Restore only if the node still holds the glitched text.
    if (g.node.data === g.glitched) g.node.data = g.original;
  }

  function lastAlikeNode(): Text | undefined {
    const lines = doc.querySelectorAll('#transcript .line--original');
    for (let i = lines.length - 1; i >= 0; i--) {
      const el = lines[i] as Element;
      if (!ALIKE.test(el.textContent ?? '')) continue;
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 3 && ALIKE.test((child as Text).data)) return child as Text;
      }
    }
    return undefined;
  }

  function getAudio(): AudioCtxLike | undefined {
    if (audioFailed) return undefined;
    if (audio !== undefined) return audio;
    try {
      const g = globalThis as unknown as {
        AudioContext?: new () => AudioCtxLike;
        webkitAudioContext?: new () => AudioCtxLike;
      };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (Ctor === undefined) {
        audioFailed = true;
        return undefined;
      }
      audio = new Ctor();
      return audio;
    } catch {
      audioFailed = true;
      return undefined;
    }
  }

  /** Rising sting at low gain; returns a stopper. Failure is ignored. */
  function startSting(): () => void {
    try {
      const ctx = getAudio();
      if (ctx === undefined) return () => {};
      void ctx.resume?.().catch(() => {});
      const t0 = ctx.currentTime;
      const dur = FLICKER_MS / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(880, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.04, t0 + 0.1);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
      return () => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          /* already stopped */
        }
      };
    } catch {
      audioFailed = true;
      return () => {};
    }
  }

  let voice: GhostVoice | undefined;

  function getVoice(): GhostVoice | undefined {
    if (voice !== undefined) return voice;
    if (deps.kv === undefined || deps.createQueue === undefined) return undefined;
    try {
      const g = globalThis as unknown as {
        fetch?: (url: string) => Promise<FetchResponseLike>;
        AudioContext?: new () => VoiceContextLike;
        webkitAudioContext?: new () => VoiceContextLike;
      };
      voice = createGhostVoice({
        doc,
        kv: deps.kv,
        motion: deps.motion,
        createQueue: deps.createQueue,
        log: (message, error) => deps.log?.error(message, error),
        now: deps.now ?? (() => Date.now()),
        fetchFn: deps.fetchFn ?? ((url) => g.fetch!(url)),
        makeContext:
          deps.makeContext ??
          (() => {
            const Ctor = g.AudioContext ?? g.webkitAudioContext;
            return Ctor === undefined ? undefined : new Ctor();
          }),
      });
    } catch {
      voice = undefined;
    }
    return voice;
  }

  function stopFlicker(): void {
    const f = flicker;
    if (f === undefined) return;
    flicker = undefined;
    clearTimeout(f.timer);
    f.el.classList.remove(FLICKER_CLASS);
    f.stop();
    doc.removeEventListener('keydown', stopFlicker, true);
    doc.removeEventListener('pointerdown', stopFlicker, true);
  }

  return {
    setDim(level) {
      if (!Number.isFinite(level)) return;
      const v = Math.min(1, Math.max(0, level));
      root.style.setProperty(DIM_PROPERTY, String(v));
    },

    flashGlitch() {
      if (deps.motion.reduced()) return;
      restoreGlitch();
      const node = lastAlikeNode();
      if (node === undefined) return;
      const original = node.data;
      const glitched = original.replace(ALIKE, 'all haunted');
      node.data = glitched;
      const timer = setTimeout(restoreGlitch, GLITCH_MS) as unknown as number;
      glitch = { node, original, glitched, timer };
    },

    reincarnate() {
      if (deps.motion.reduced()) return;
      stopFlicker();
      const el = doc.querySelector('.crt');
      if (el === null) return;
      el.classList.add(FLICKER_CLASS);
      const stop = startSting();
      const timer = setTimeout(stopFlicker, FLICKER_MS) as unknown as number;
      flicker = { el, timer, stop };
      // Capture phase: a key press that is already being dispatched has passed it.
      doc.addEventListener('keydown', stopFlicker, true);
      doc.addEventListener('pointerdown', stopFlicker, true);
    },

    reset() {
      restoreGlitch();
      stopFlicker();
      root.style.removeProperty(DIM_PROPERTY);
      try {
        voice?.dispose();
      } catch {
        /* ignore */
      }
    },

    start() {
      try {
        void getVoice()?.start();
      } catch {
        /* voice is optional */
      }
    },

    speak(item) {
      try {
        voice?.speak(item);
      } catch {
        /* voice is optional */
      }
    },

    stopSpeaking() {
      try {
        voice?.stop();
      } catch {
        /* voice is optional */
      }
    },
  };
}
