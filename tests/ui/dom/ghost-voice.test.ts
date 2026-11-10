// @vitest-environment happy-dom
// ghost-voice tasks 4.1/4.2: module + toggle with fakes (no network, no audio device).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpeechQueue } from '../../../src/haunt/speech-queue';
import {
  GHOST_VOICE_CHUNK_MARKER,
  VOICE_PREF_KEY,
  createGhostVoice,
} from '../../../src/ui/dom/ghost-voice';
import type { GhostVoice } from '../../../src/ui/dom/ghost-voice';
import { MemoryKeyValueStore } from '../../../src/ui/kv-store';
import { FakeAudioContext } from '../support/fake-audio';
import { FakeMotion } from '../support/fakes';

const MANIFEST = {
  version: 1,
  model: 'm',
  entries: { aaaa0001: { file: 'aaaa0001.mp3', bytes: 3, text: 'one' }, bbbb0002: { file: 'bbbb0002.mp3', bytes: 3, text: 'two' } },
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

function buildDom(): void {
  document.body.innerHTML =
    '<header id="controls"><button>1976 MODE</button><button>CRT</button><button>New game</button></header>' +
    '<input id="input"><button id="mic" aria-pressed="false">MIC</button>';
}

interface Rig {
  voice: GhostVoice;
  kv: MemoryKeyValueStore;
  ctx: FakeAudioContext;
  urls: string[];
  fail: Set<string>;
  makeCtxCalls: () => number;
  time: { t: number };
}

function rig(manifest: unknown = MANIFEST): Rig {
  const kv = new MemoryKeyValueStore();
  const ctx = new FakeAudioContext();
  const urls: string[] = [];
  const fail = new Set<string>();
  const time = { t: 0 };
  let ctxCalls = 0;
  const voice = createGhostVoice({
    doc: document,
    kv,
    motion: new FakeMotion(),
    fetchFn: async (url) => {
      urls.push(url);
      if (fail.has(url)) throw new Error('net');
      if (url.endsWith('manifest.json')) {
        return {
          ok: manifest !== null,
          json: async () => manifest,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      return { ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(4) };
    },
    makeContext: () => {
      ctxCalls++;
      return ctx;
    },
    createQueue: (d) => createSpeechQueue(d),
    log: () => {},
    now: () => time.t,
  });
  return { voice, kv, ctx, urls, fail, makeCtxCalls: () => ctxCalls, time };
}

const unlock = (): void => {
  document.dispatchEvent(new Event('keydown'));
};
const toggleEl = (): HTMLElement | null => document.getElementById('voice-toggle');

let current: Rig | undefined;
beforeEach(() => {
  buildDom();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  current?.voice.dispose();
  current = undefined;
});

async function started(manifest: unknown = MANIFEST): Promise<Rig> {
  const r = rig(manifest);
  current = r;
  await r.voice.start();
  return r;
}

describe('ghost voice', () => {
  it('exports a distinctive marker', () => {
    expect(GHOST_VOICE_CHUNK_MARKER.length).toBeGreaterThan(10);
  });

  it('is inactive with no toggle and no audio without a manifest', async () => {
    for (const m of [null, { version: 1, entries: {} }, 'junk']) {
      const r = await started(m);
      expect(r.voice.isActive()).toBe(false);
      expect(toggleEl()).toBeNull();
      unlock();
      r.voice.speak({ key: 'aaaa0001', text: 'one' });
      await flush();
      expect(r.ctx.sources).toHaveLength(0);
      r.voice.dispose();
    }
  });

  it('is inactive when the manifest fetch throws', async () => {
    const r = rig();
    current = r;
    r.fail.add('/voice/manifest.json');
    await r.voice.start();
    expect(toggleEl()).toBeNull();
  });

  it('adds the toggle right after the CRT control, on by default', async () => {
    await started();
    const t = toggleEl()!;
    expect(t.previousElementSibling?.textContent).toBe('CRT');
    expect(t.textContent).toBe('VOICE: ON');
    expect(t.getAttribute('aria-pressed')).toBe('true');
  });

  it('persists the preference and restores it', async () => {
    const r = await started();
    toggleEl()!.click();
    expect(toggleEl()!.textContent).toBe('VOICE: OFF');
    expect(toggleEl()!.getAttribute('aria-pressed')).toBe('false');
    expect(r.kv.get(VOICE_PREF_KEY)).toBe('0');
    toggleEl()!.click();
    expect(r.kv.get(VOICE_PREF_KEY)).toBe('1');

    r.kv.set(VOICE_PREF_KEY, '0');
    r.voice.dispose();
    await r.voice.start();
    expect(toggleEl()!.textContent).toBe('VOICE: OFF');
  });

  it('re-inserts the toggle after the controls are rebuilt', async () => {
    const r = await started();
    document.getElementById('controls')!.replaceChildren(
      Object.assign(document.createElement('button'), { textContent: 'CRT' }),
    );
    expect(toggleEl()).toBeNull();
    await r.voice.start();
    expect(toggleEl()!.previousElementSibling?.textContent).toBe('CRT');
  });

  it('drops lines before the first interaction, plays after', async () => {
    const r = await started();
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    expect(r.ctx.sources).toHaveLength(0);
    expect(r.makeCtxCalls()).toBe(0);
    unlock();
    expect(r.makeCtxCalls()).toBe(1);
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    expect(r.ctx.sources).toHaveLength(1);
    const s = r.ctx.sources[0]!;
    expect(s.started).toBe(1);
    expect(s.playbackRate.value).toBe(0.92);
    expect(r.urls).toContain('/voice/aaaa0001.mp3');
    expect(toggleEl()!.getAttribute('data-speaking')).toBe('true');
    s.finish();
    expect(toggleEl()!.hasAttribute('data-speaking')).toBe(false);
  });

  it('ignores keys without a manifest entry and does not fetch them', async () => {
    const r = await started();
    unlock();
    r.voice.speak({ key: 'zzzz', text: 'x' });
    await flush();
    expect(r.urls).toEqual(['/voice/manifest.json']);
  });

  it('turning VOICE off stops playback and silences later lines', async () => {
    const r = await started();
    unlock();
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    const s = r.ctx.sources[0]!;
    toggleEl()!.click();
    expect(s.stopped).toBe(1);
    expect(toggleEl()!.hasAttribute('data-speaking')).toBe(false);
    r.voice.speak({ key: 'bbbb0002', text: 'two' });
    await flush();
    expect(r.ctx.sources).toHaveLength(1);
  });

  const stoppers: Array<[string, () => void]> = [
    ['typing in #input', () => document.getElementById('input')!.dispatchEvent(new Event('input'))],
    ['keydown on #input', () => document.getElementById('input')!.dispatchEvent(new Event('keydown'))],
    ['pointerdown on #mic', () => document.getElementById('mic')!.dispatchEvent(new Event('pointerdown'))],
    ['keydown on #mic', () => document.getElementById('mic')!.dispatchEvent(new Event('keydown'))],
    [
      'hidden tab',
      () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
  ];
  for (const [name, act] of stoppers) {
    it(`${name} stops the line and clears the waiting one`, async () => {
      const r = await started();
      unlock();
      r.voice.speak({ key: 'aaaa0001', text: 'one' });
      await flush();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      r.voice.speak({ key: 'bbbb0002', text: 'two' });
      act();
      const s = r.ctx.sources[0]!;
      expect(s.stopped).toBe(1);
      await flush();
      expect(r.ctx.sources).toHaveLength(1); // waiting line was dropped
      expect(toggleEl()!.hasAttribute('data-speaking')).toBe(false);
    });
  }

  it('aria-pressed change on #mic stops the line', async () => {
    const r = await started();
    unlock();
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    document.getElementById('mic')!.setAttribute('aria-pressed', 'true');
    await flush();
    expect(r.ctx.sources[0]!.stopped).toBe(1);
  });

  it('plays the waiting line after the current one ends; only one source at a time', async () => {
    const r = await started();
    unlock();
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    r.voice.speak({ key: 'bbbb0002', text: 'two' });
    await flush();
    expect(r.ctx.sources).toHaveLength(1);
    r.ctx.sources[0]!.finish();
    await flush();
    expect(r.ctx.sources).toHaveLength(2);
    expect(r.ctx.sources[1]!.started).toBe(1);
  });

  it('skips silently on fetch error, missing file and decode error', async () => {
    const r = await started();
    unlock();
    r.fail.add('/voice/aaaa0001.mp3');
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    expect(r.ctx.sources).toHaveLength(0);
    r.ctx.decodeFails = true;
    r.voice.speak({ key: 'bbbb0002', text: 'two' });
    await flush();
    expect(r.ctx.sources).toHaveLength(0);
    // queue not wedged, and failures are cached (no refetch)
    r.ctx.decodeFails = false;
    const before = r.urls.length;
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    expect(r.urls.length).toBe(before);
    expect(toggleEl()!.hasAttribute('data-speaking')).toBe(false);
  });

  it('dispose stops playback, removes the toggle and the listeners', async () => {
    const r = await started();
    unlock();
    r.voice.speak({ key: 'aaaa0001', text: 'one' });
    await flush();
    r.voice.dispose();
    expect(r.ctx.sources[0]!.stopped).toBe(1);
    expect(toggleEl()).toBeNull();
    r.voice.speak({ key: 'bbbb0002', text: 'two' });
    await flush();
    expect(r.ctx.sources).toHaveLength(1);
    // listeners gone: events no longer call stop
    document.getElementById('input')!.dispatchEvent(new Event('input'));
    expect(r.ctx.sources[0]!.stopped).toBe(1);
  });

  it('never throws when audio is unavailable', async () => {
    const kv = new MemoryKeyValueStore();
    const v = createGhostVoice({
      doc: document,
      kv,
      motion: new FakeMotion(),
      fetchFn: async () => ({ ok: true, json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(1) }),
      makeContext: () => {
        throw new Error('no audio');
      },
      createQueue: (d) => createSpeechQueue(d),
      log: () => {},
      now: () => 0,
    });
    current = { voice: v } as Rig;
    await v.start();
    unlock();
    expect(() => v.speak({ key: 'aaaa0001', text: 'one' })).not.toThrow();
    await flush();
  });
});
