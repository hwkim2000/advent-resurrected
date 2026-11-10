// Ghost_Voice: plays pre-generated narrator audio (public/voice/*.mp3) through a
// Web Audio ghost chain in Haunted mode. Loaded lazily with the haunt effects,
// never in 1976 mode. Fully inactive (no toggle, no sound) without
// /voice/manifest.json. Everything is guarded: a failure means silence, never a
// broken game. The speech queue policy lives in src/haunt (pure) and is injected
// (`createQueue`) because src/ui may not import src/haunt.

import type { KeyValueStore, MotionPreference } from '../types';
import { GHOST_PLAYBACK_RATE, buildGhostChain } from './ghost-chain';
import type { ChainContextLike, GainLike, GhostChain, NodeLike, ParamLike } from './ghost-chain';

/** Distinctive string kept in the lazy chunk; scripts/check-dist.ts looks for it. */
export const GHOST_VOICE_CHUNK_MARKER = 'ghost-voice-chunk-marker-7f3a1c';

export const VOICE_TOGGLE_ID = 'voice-toggle';
export const VOICE_PREF_KEY = 'advent.ghost-voice';
export const VOICE_MANIFEST_URL = '/voice/manifest.json';
export const FADE_OUT_S = 0.03;
export const BUFFER_CACHE_MAX = 16;

export interface VoiceItem {
  key: string;
  text: string;
}

/** Structural twin of src/haunt/speech-queue (src/ui cannot import it). */
export interface QueueLike<T> {
  offer(item: T): void;
  cancel(): void;
  isPlaying(): boolean;
  hasWaiting(): boolean;
}
export interface QueuePlayerLike<T> {
  play(item: T, onEnd: () => void): void;
  stop(): void;
}
export type CreateQueue = <T>(deps: { player: QueuePlayerLike<T>; now(): number }) => QueueLike<T>;

export interface SourceLike extends NodeLike {
  buffer: unknown;
  playbackRate: ParamLike;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface VoiceContextLike extends ChainContextLike {
  readonly currentTime: number;
  readonly state?: string;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume?(): Promise<void>;
}

export interface FetchResponseLike {
  ok: boolean;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface GhostVoiceDeps {
  doc: Document;
  kv: KeyValueStore;
  motion: MotionPreference;
  fetchFn: (url: string) => Promise<FetchResponseLike>;
  /** Creates the audio context; returns undefined when Web Audio is unavailable. */
  makeContext: () => VoiceContextLike | undefined;
  createQueue: CreateQueue;
  log: (message: string, error?: unknown) => void;
  now: () => number;
}

export interface GhostVoice {
  start(): Promise<void>;
  speak(item: VoiceItem): void;
  stop(): void;
  dispose(): void;
  isActive(): boolean;
}

interface ManifestEntry {
  file: string;
}

const SAFE_FILE = /^[A-Za-z0-9._-]+$/;

function parseManifest(raw: unknown): Map<string, ManifestEntry> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entries = (raw as { entries?: unknown }).entries;
  if (typeof entries !== 'object' || entries === null) return undefined;
  const map = new Map<string, ManifestEntry>();
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const file = (value as { file?: unknown } | null)?.file;
    if (typeof file === 'string' && SAFE_FILE.test(file)) map.set(key, { file });
  }
  return map.size > 0 ? map : undefined;
}

export function createGhostVoice(deps: GhostVoiceDeps): GhostVoice {
  const { doc, kv, fetchFn, log } = deps;

  let manifest: Map<string, ManifestEntry> | undefined;
  let manifestTried = false;
  let enabled = true;
  let unlocked = false;
  let disposed = true; // inactive until start()
  let generation = 0;
  let ctx: VoiceContextLike | undefined;
  let chain: GhostChain | undefined;
  let current: { source: SourceLike; gain: GainLike } | undefined;
  let playToken = 0;
  let toggle: HTMLButtonElement | undefined;
  let cleanups: Array<() => void> = [];
  const cache = new Map<string, unknown>(); // key -> decoded buffer, or null = no audio
  let queue: QueueLike<VoiceItem> | undefined;

  function guard(label: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      try {
        log(`ghost-voice: ${label} failed`, e);
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- toggle ----------

  function updateToggle(): void {
    if (toggle === undefined) return;
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'VOICE: ON' : 'VOICE: OFF';
  }

  function setSpeaking(on: boolean): void {
    if (toggle === undefined) return;
    if (on) toggle.setAttribute('data-speaking', 'true');
    else toggle.removeAttribute('data-speaking');
  }

  function findCrtButton(controls: Element): Element | undefined {
    for (const b of Array.from(controls.querySelectorAll('button'))) {
      if ((b.textContent ?? '').trim() === 'CRT') return b;
    }
    return undefined;
  }

  /** Creates the toggle once; (re)inserts it after the CRT control when detached. */
  function ensureToggle(): void {
    if (disposed || manifest === undefined) return;
    if (toggle === undefined) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = VOICE_TOGGLE_ID;
      // Keeps the marker in the built chunk (check-dist looks for it).
      b.setAttribute('data-voice-build', GHOST_VOICE_CHUNK_MARKER);
      b.addEventListener('click', () => {
        guard('toggle', () => {
          enabled = !enabled;
          try {
            kv.set(VOICE_PREF_KEY, enabled ? '1' : '0');
          } catch (e) {
            log('ghost-voice: preference not saved', e);
          }
          updateToggle();
          if (!enabled) stop();
        });
      });
      toggle = b;
      updateToggle();
    }
    if (toggle.isConnected) return;
    const controls = doc.getElementById('controls');
    if (controls === null) return;
    const crt = findCrtButton(controls);
    if (crt !== undefined) crt.after(toggle);
    else controls.appendChild(toggle);
  }

  // ---------- audio ----------

  function ensureContext(): VoiceContextLike | undefined {
    if (ctx !== undefined) return ctx;
    try {
      ctx = deps.makeContext();
      if (ctx !== undefined) chain = buildGhostChain(ctx);
    } catch (e) {
      log('ghost-voice: audio unavailable', e);
      ctx = undefined;
      chain = undefined;
    }
    return ctx;
  }

  function cachePut(key: string, value: unknown): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > BUFFER_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function loadBuffer(key: string, c: VoiceContextLike): Promise<unknown> {
    if (cache.has(key)) {
      const hit = cache.get(key);
      cachePut(key, hit);
      return hit;
    }
    const entry = manifest?.get(key);
    let buf: unknown = null;
    if (entry !== undefined) {
      try {
        const res = await fetchFn(`/voice/${entry.file}`);
        if (res.ok) buf = await c.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        log(`ghost-voice: could not load ${entry.file}`, e);
        buf = null;
      }
    }
    cachePut(key, buf);
    return buf;
  }

  function fadeAndStop(cur: { source: SourceLike; gain: GainLike }): void {
    try {
      cur.source.onended = null;
      const c = ctx;
      if (c !== undefined) {
        const t = c.currentTime;
        const g = cur.gain.gain;
        g.cancelScheduledValues?.(t);
        g.setValueAtTime?.(g.value, t);
        g.linearRampToValueAtTime?.(0, t + FADE_OUT_S);
        cur.source.stop(t + FADE_OUT_S + 0.01);
      } else {
        cur.source.stop();
      }
    } catch {
      /* already stopped */
    }
  }

  const player: QueuePlayerLike<VoiceItem> = {
    play(item, onEnd) {
      const token = ++playToken;
      const c = ctx;
      if (c === undefined || chain === undefined) {
        onEnd();
        return;
      }
      const input = chain.input;
      void (async () => {
        try {
          const buf = await loadBuffer(item.key, c);
          if (token !== playToken) return; // stopped meanwhile
          if (buf === null || buf === undefined) {
            onEnd();
            return;
          }
          const source = c.createBufferSource();
          const gain = c.createGain();
          source.buffer = buf;
          source.playbackRate.value = GHOST_PLAYBACK_RATE;
          gain.gain.value = 1;
          source.connect(gain);
          gain.connect(input);
          current = { source, gain };
          source.onended = () => {
            if (token !== playToken) return;
            current = undefined;
            setSpeaking(false);
            try {
              source.disconnect?.();
              gain.disconnect?.();
            } catch {
              /* ignore */
            }
            onEnd();
          };
          source.start();
          setSpeaking(true);
        } catch (e) {
          log('ghost-voice: playback failed', e);
          if (token === playToken) {
            current = undefined;
            setSpeaking(false);
            onEnd();
          }
        }
      })();
    },
    stop() {
      playToken++;
      const cur = current;
      current = undefined;
      setSpeaking(false);
      if (cur !== undefined) fadeAndStop(cur);
    },
  };

  function stop(): void {
    guard('stop', () => {
      if (queue !== undefined) queue.cancel();
      else player.stop();
    });
  }

  // ---------- listeners ----------

  function listen(
    target: EventTarget,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  function unlock(): void {
    if (unlocked) return;
    unlocked = true;
    guard('unlock', () => {
      const c = ensureContext();
      void c?.resume?.()?.catch?.(() => {});
    });
  }

  function isHidden(): boolean {
    return doc.visibilityState === 'hidden' || doc.hidden === true;
  }

  function attach(): void {
    if (!unlocked) {
      const once = (): void => {
        for (const t of ['keydown', 'pointerdown', 'touchend']) {
          doc.removeEventListener(t, once, true);
        }
        unlock();
      };
      for (const t of ['keydown', 'pointerdown', 'touchend']) {
        doc.addEventListener(t, once, true);
        cleanups.push(() => doc.removeEventListener(t, once, true));
      }
    }
    const input = doc.getElementById('input');
    if (input !== null) {
      listen(input, 'input', stop);
      listen(input, 'keydown', stop);
    }
    const mic = doc.getElementById('mic');
    if (mic !== null) {
      listen(mic, 'pointerdown', stop);
      listen(mic, 'keydown', stop);
      const MO = (doc.defaultView as unknown as { MutationObserver?: typeof MutationObserver } | null)
        ?.MutationObserver;
      if (MO !== undefined) {
        const mo = new MO(() => stop());
        mo.observe(mic, { attributes: true, attributeFilter: ['aria-pressed'] });
        cleanups.push(() => mo.disconnect());
      }
    }
    listen(doc, 'visibilitychange', () => {
      if (isHidden()) stop();
    });
  }

  function detach(): void {
    const list = cleanups;
    cleanups = [];
    for (const fn of list) guard('detach', fn);
  }

  // ---------- public API ----------

  return {
    async start() {
      const gen = ++generation;
      const wasDisposed = disposed;
      disposed = false;
      try {
        if (!manifestTried) {
          manifestTried = true;
          try {
            const res = await fetchFn(VOICE_MANIFEST_URL);
            manifest = res.ok ? parseManifest(await res.json()) : undefined;
          } catch (e) {
            log('ghost-voice: no manifest', e);
            manifest = undefined;
          }
        }
        if (gen !== generation || disposed) return;
        if (manifest === undefined) return;
        if (wasDisposed || cleanups.length === 0) {
          detach();
          try {
            enabled = kv.get(VOICE_PREF_KEY) !== '0';
          } catch {
            enabled = true;
          }
          queue ??= deps.createQueue<VoiceItem>({ player, now: deps.now });
          attach();
        }
        ensureToggle();
        updateToggle();
      } catch (e) {
        log('ghost-voice: start failed', e);
      }
    },

    speak(item) {
      guard('speak', () => {
        if (disposed || manifest === undefined || !enabled || !unlocked) return;
        if (isHidden()) return;
        if (!manifest.has(item.key)) return;
        if (ensureContext() === undefined || queue === undefined) return;
        ensureToggle();
        queue.offer(item);
      });
    },

    stop,

    dispose() {
      guard('dispose', () => {
        generation++;
        disposed = true;
        stop();
        detach();
        if (toggle !== undefined) {
          toggle.remove();
          toggle = undefined;
        }
      });
    },

    isActive: () => !disposed && manifest !== undefined,
  };
}
