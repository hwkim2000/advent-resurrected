// Entry point: wires the real browser (localStorage, matchMedia, rAF, DOM) to
// the GameController. Typing only; no hooks are registered in this spec.

import { GameController } from './ui/game-controller';
import { ExtensionHooks } from './ui/extension-hooks';
import { ResilientStore } from './ui/kv-store';
import { SETTINGS_KEY } from './ui/save-store';
import { parseSettings } from './ui/settings';
import {
  createClock,
  createLocalStorageStore,
  createLogger,
  createMotionPreference,
} from './ui/dom/browser-ports';
import { applyCrt, mountControls } from './ui/dom/controls';
import { installInputLine } from './ui/dom/input-line';
import { TerminalView, findTerminalElements } from './ui/dom/terminal-view';
import { installViewportTracking } from './ui/dom/viewport';

import { createHauntedStartLoader } from './ai-loader';
import type { AiParserModule } from './ai-loader';
import { createGameStartFanOut } from './game-start-fanout';
import { createHauntingLoader } from './haunting-loader';
import type { HauntEffectsModule, HauntingModule } from './haunting-loader';
import { createVoiceStartLoader } from './voice-loader';
import type { HauntModule, VoiceModule } from './voice-loader';
import { installMicButton } from './ui/dom/mic-button';
import type { MicElements } from './ui/dom/mic-button';

/** The only reference to src/parser: a dynamic import, so the chunk is split out. */
const loadParserModule = (): Promise<AiParserModule> => import('./parser/browser');

/** Dynamic imports only: the voice and haunt layers stay out of the start script. */
const loadVoiceModule = (): Promise<VoiceModule> => import('./voice/browser');
const loadHauntModule = (): Promise<HauntModule> => import('./haunt/spoken-word-rule');

const loadHauntingModule = (): Promise<HauntingModule> => import('./haunt/haunting');
const loadHauntEffectsModule = (): Promise<HauntEffectsModule> => import('./ui/dom/haunt-effects');

function main(): void {
  const els = findTerminalElements();
  const cursor = document.getElementById('cursor');
  const controlsEl = document.getElementById('controls');
  const screen = document.getElementById('screen');
  if (!cursor || !controlsEl) throw new Error('Missing UI elements');

  // The storage callback can fire before the controller exists; remember it.
  let controller: GameController | undefined;
  let degradedEarly = false;
  const kv = new ResilientStore(createLocalStorageStore(), () => {
    if (controller) controller.notifyStorageDegraded();
    else degradedEarly = true;
  });

  // Apply CRT and Mode to the DOM before the boot starts.
  const early = parseSettings(kv.get(SETTINGS_KEY));
  applyCrt(early.crt);
  els.root.dataset['selectedMode'] = early.mode;

  // Track the Teletype busy state for the input line.
  let busy = false;
  class BusyTrackingView extends TerminalView {
    override setBusy(b: boolean): void {
      busy = b;
      super.setBusy(b);
    }
  }
  const view = new BusyTrackingView(els);

  const log = createLogger();
  const motion = createMotionPreference();
  const hooks = new ExtensionHooks(log);
  // The AI parser chunk loads only when a Haunted game starts (never in 1976 mode).
  const aiLoader = { onGameStart: createHauntedStartLoader(() => controller, log, loadParserModule) };

  // Mic button: installed at startup in every mode; the voice layer attaches later.
  const byId = (id: string): HTMLElement | null => document.getElementById(id);
  const mic = installMicButton({
    els: {
      button: byId('mic'),
      status: byId('voice-status'),
      disclosure: byId('mic-disclosure'),
      unavailable: byId('mic-unavailable'),
      live: byId('voice-live'),
      input: els.input,
    } as unknown as MicElements,
  });

  // The voice chunks load only when a Haunted game starts (never in 1976 mode).
  const voiceLoader = createVoiceStartLoader({
    getHost: () => {
      const c = controller;
      if (!c) return undefined;
      return {
        submit: (line, origin) => c.submit(line, origin),
        get promptKind() {
          return c.promptKind;
        },
        get phase() {
          return c.phase;
        },
        get gameMode() {
          return c.gameMode;
        },
        log,
        addInputGate: (gate) => hooks.addInputGate(gate),
      };
    },
    log,
    loadVoice: loadVoiceModule,
    loadHaunt: loadHauntModule,
    onLayer: (layer) => {
      mic.attach(layer.port);
    },
  });
  // Haunting (narrator, dim, glitch, reincarnation): chunks load on the first Haunted start.
  const hauntingStart = createHauntingLoader({
    getHost: () => {
      const c = controller;
      if (!c) return undefined;
      return {
        hooks,
        motion,
        get engineState() {
          return c.engineState;
        },
      };
    },
    log,
    loadHaunting: loadHauntingModule,
    loadEffects: loadHauntEffectsModule,
    seed: Date.now() | 0,
    kv,
  });
  const onGameStart = createGameStartFanOut(
    [aiLoader.onGameStart, voiceLoader.onGameStart, hauntingStart],
    log,
  );
  const ctl = new GameController({
    kv,
    clock: createClock(),
    motion,
    view,
    hooks,
    log,
    confirm: (message) => window.confirm(message),
    onGameStart,
  });
  controller = ctl;
  if (degradedEarly) ctl.notifyStorageDegraded();

  mountControls(controlsEl, ctl);
  installInputLine({
    input: els.input,
    cursor,
    screen,
    controller: ctl,
    isBusy: () => busy,
  });
  installViewportTracking(els.root, els.input.closest('.input-line') as HTMLElement | null);

  // Focus at startup so keys typed during the boot are kept (the first key skips it).
  els.input.focus();
  ctl.startBoot();

  // Drive the Teletype; when the phase changes, re-focus the input if focus was lost.
  let lastPhase = ctl.phase;
  const frame = (now: number): void => {
    ctl.tick(now);
    voiceLoader.syncHost();
    if (ctl.phase !== lastPhase) {
      lastPhase = ctl.phase;
      const active = document.activeElement;
      const lost = active === null || active === document.body || active === document.documentElement;
      if (lost && !els.input.disabled) els.input.focus();
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

main();
