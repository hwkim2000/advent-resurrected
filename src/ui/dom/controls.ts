// Native settings controls: Mode radio-style group, Typing_Speed select, CRT
// toggle, New game button and Credits link. Text only via textContent /
// attributes (never innerHTML). Buttons and the select are native, so Tab and
// Enter/Space work without extra key handling.

import { SPEED_CHOICES } from '../settings';
import type { Settings } from '../settings';
import type { Mode, Speed } from '../types';

/** The slice of GameController the controls need. */
export interface ControlsController {
  readonly settings: Settings;
  setMode(mode: Mode): void;
  setSpeed(speed: Speed): void;
  setCrt(on: boolean): void;
  requestNewGame(): void;
}

export const CREDITS_HREF = '/credits.html';

const MODE_CHOICES: readonly { mode: Mode; label: string }[] = [
  { mode: '1976', label: '1976 MODE' },
  { mode: 'haunted', label: 'HAUNTED MODE' },
];

function speedLabel(s: Speed): string {
  return s === 'instant' ? 'INSTANT' : String(s);
}

/** Applies the CRT setting to `html[data-crt]` ("on" or "off"). */
export function applyCrt(on: boolean, root: HTMLElement = document.documentElement): void {
  root.dataset['crt'] = on ? 'on' : 'off';
}

/**
 * Builds the controls inside `container` (replacing its children) and wires them
 * to the controller. Returns a function that re-syncs the UI from the controller.
 */
export function mountControls(
  container: HTMLElement,
  controller: ControlsController,
  doc: Document = container.ownerDocument,
  root: HTMLElement = doc.documentElement,
): () => void {
  container.replaceChildren();

  // Mode: radio-style group of two buttons.
  const group = doc.createElement('div');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Mode');
  const modeButtons = new Map<Mode, HTMLButtonElement>();
  for (const choice of MODE_CHOICES) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = choice.label;
    b.addEventListener('click', () => {
      if (controller.settings.mode !== choice.mode) controller.setMode(choice.mode);
      sync();
    });
    modeButtons.set(choice.mode, b);
    group.appendChild(b);
  }

  // Typing speed.
  const speedId = 'typing-speed';
  const speedLabelEl = doc.createElement('label');
  speedLabelEl.htmlFor = speedId;
  speedLabelEl.textContent = 'SPEED ';
  const select = doc.createElement('select');
  select.id = speedId;
  for (const s of SPEED_CHOICES) {
    const o = doc.createElement('option');
    o.value = String(s);
    o.textContent = speedLabel(s);
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    const chosen = SPEED_CHOICES.find((s) => String(s) === select.value);
    if (chosen !== undefined) controller.setSpeed(chosen);
  });
  speedLabelEl.appendChild(select);

  // CRT toggle.
  const crt = doc.createElement('button');
  crt.type = 'button';
  crt.textContent = 'CRT';
  crt.addEventListener('click', () => {
    const next = !controller.settings.crt;
    controller.setCrt(next);
    sync();
  });

  // New game.
  const newGame = doc.createElement('button');
  newGame.type = 'button';
  newGame.textContent = 'New game';
  newGame.addEventListener('click', () => controller.requestNewGame());

  // Credits.
  const credits = doc.createElement('a');
  credits.href = CREDITS_HREF;
  credits.target = '_blank';
  credits.rel = 'noopener';
  credits.textContent = 'Credits';

  container.append(group, speedLabelEl, crt, newGame, credits);

  function sync(): void {
    const s = controller.settings;
    for (const [mode, b] of modeButtons) {
      b.setAttribute('aria-checked', String(mode === s.mode));
    }
    select.value = String(s.speed);
    crt.setAttribute('aria-pressed', String(s.crt));
    applyCrt(s.crt, root);
  }

  sync();
  return sync;
}
