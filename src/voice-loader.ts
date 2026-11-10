// Lazy voice loading policy (voice-input spec, Requirements 1 and 13.8). No
// reference to src/voice or src/haunt here: main.ts supplies the dynamic import()s.
// Structural types only, the same pattern as ai-loader.ts.

import type { InputGate } from './ui/extension-hooks';
import type { Logger, Mode } from './ui/types';
import type { VoiceLayer, VoiceLayerHost } from './ui/voice-port';

export interface VoiceModule {
  createBrowserVoiceLayer(host: VoiceLayerHost): VoiceLayer;
}

export interface HauntModule {
  createSpokenWordGate(deps: { isVoiceUsable(): boolean }): InputGate;
}

export type VoiceLoaderHost = VoiceLayerHost & { addInputGate(gate: InputGate): () => void };

export interface VoiceLoaderDeps {
  getHost(): VoiceLoaderHost | undefined;
  log: Logger;
  loadVoice(): Promise<VoiceModule>;
  loadHaunt(): Promise<HauntModule>;
  /** main.ts attaches layer.port to the DOM module here. */
  onLayer?(layer: VoiceLayer): void;
}

export interface VoiceStartLoader {
  onGameStart(mode: Mode): void;
  syncHost(): void;
}

/**
 * Loads the voice and haunt chunks on the first Haunted game start (never in
 * 1976 mode, one load at a time, a successful load is kept), and manages the
 * Spoken_Word_Rule gate per game. Never awaited on the game path.
 */
export function createVoiceStartLoader(deps: VoiceLoaderDeps): VoiceStartLoader {
  let latestMode: Mode | undefined;
  let loading = false;
  let layer: VoiceLayer | undefined;
  let haunt: HauntModule | undefined;
  let host: VoiceLoaderHost | undefined;
  let disposeGate: (() => void) | undefined;

  // Runs for every game start once the layer exists.
  function applyMode(mode: Mode): void {
    if (layer === undefined) return;
    if (mode === '1976') {
      // Synchronously, before the first line of the 1976 game.
      if (disposeGate !== undefined) {
        const dispose = disposeGate;
        disposeGate = undefined;
        dispose();
      }
      layer.gameStart(mode);
      return;
    }
    layer.gameStart(mode);
    if (disposeGate === undefined && haunt !== undefined && host !== undefined) {
      const l = layer;
      disposeGate = host.addInputGate(haunt.createSpokenWordGate({ isVoiceUsable: () => l.usable }));
    }
  }

  function startLoad(): void {
    loading = true;
    let pending: Promise<[VoiceModule, HauntModule]>;
    try {
      pending = Promise.all([deps.loadVoice(), deps.loadHaunt()]);
    } catch (e) {
      loading = false;
      deps.log.error('voice failed to load', e);
      return;
    }
    pending.then(
      ([voiceMod, hauntMod]) => {
        loading = false;
        try {
          const h = deps.getHost();
          if (h === undefined) throw new Error('voice host unavailable');
          const created = voiceMod.createBrowserVoiceLayer(h);
          host = h;
          haunt = hauntMod;
          layer = created;
          deps.onLayer?.(created);
          applyMode(latestMode ?? '1976');
        } catch (e) {
          if (layer === undefined) {
            host = undefined;
            haunt = undefined;
          }
          deps.log.error('voice failed to load', e);
        }
      },
      (e: unknown) => {
        loading = false;
        deps.log.error('voice failed to load', e);
      },
    );
  }

  return {
    onGameStart(mode) {
      latestMode = mode;
      if (layer !== undefined) {
        applyMode(mode);
        return;
      }
      if (mode === 'haunted' && !loading) startLoad();
    },
    syncHost() {
      layer?.syncHost();
    },
  };
}
