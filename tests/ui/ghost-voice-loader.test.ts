// @vitest-environment happy-dom
// ghost-voice task 5.2: the real loader + real chunks. 1976 never fetches /voice/*;
// Haunted shows the toggle; switching to 1976 removes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHauntingLoader } from '../../src/haunting-loader';
import { ExtensionHooks } from '../../src/ui/extension-hooks';
import { MemoryKeyValueStore } from '../../src/ui/kv-store';
import { FakeMotion, RecordingLogger } from './support/fakes';

const MANIFEST = { version: 1, entries: { aaaa0001: { file: 'aaaa0001.mp3', bytes: 3, text: 'one' } } };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

let urls: string[] = [];

beforeEach(() => {
  urls = [];
  document.body.innerHTML = '<header id="controls"><button>CRT</button></header><input id="input"><button id="mic"></button>';
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return { ok: true, json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(2) };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function makeLoader(): (mode: '1976' | 'haunted') => void {
  const log = new RecordingLogger();
  const hooks = new ExtensionHooks(log);
  return createHauntingLoader({
    getHost: () => ({ hooks, motion: new FakeMotion(false), engineState: undefined }),
    log,
    seed: 1,
    kv: new MemoryKeyValueStore(),
    loadHaunting: () => import('../../src/haunt/haunting'),
    loadEffects: () => import('../../src/ui/dom/haunt-effects'),
  });
}

describe('ghost voice through the haunting loader', () => {
  it('1976 start loads nothing and requests no /voice/ file', async () => {
    const load = makeLoader();
    load('1976');
    await flush();
    expect(urls).toEqual([]);
    expect(document.getElementById('voice-toggle')).toBeNull();
  });

  it('Haunted shows the toggle; switching to 1976 removes it', async () => {
    const load = makeLoader();
    load('haunted');
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0), { timeout: 5000 });
    await flush();
    expect(urls).toContain('/voice/manifest.json');
    expect(document.getElementById('voice-toggle')).not.toBeNull();
    load('1976');
    expect(document.getElementById('voice-toggle')).toBeNull();
    load('haunted');
    await flush();
    expect(document.getElementById('voice-toggle')).not.toBeNull();
  });
});

