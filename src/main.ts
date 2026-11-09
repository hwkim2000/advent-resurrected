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

/** The only reference to src/parser: a dynamic import, so the chunk is split out. */
const loadParserModule = (): Promise<AiParserModule> => import('./parser/browser');

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
  const hooks = new ExtensionHooks(log);
  // The AI parser chunk loads only when a Haunted game starts (never in 1976 mode).
  const onGameStart = createHauntedStartLoader(() => controller, log, loadParserModule);
  const ctl = new GameController({
    kv,
    clock: createClock(),
    motion: createMotionPreference(),
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
