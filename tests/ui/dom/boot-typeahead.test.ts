// @vitest-environment happy-dom
// Feature: crt-terminal-ui, bugfix: input typed during or right after the boot is kept.
// Wires the real TerminalView + installInputLine to a GameController with fakes.

import { beforeEach, describe, expect, it } from 'vitest';
import { ExtensionHooks } from '../../../src/ui/extension-hooks';
import { GameController } from '../../../src/ui/game-controller';
import { MemoryKeyValueStore } from '../../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../../src/ui/save-store';
import { printSettings } from '../../../src/ui/settings';
import { installInputLine } from '../../../src/ui/dom/input-line';
import { TerminalView, findTerminalElements } from '../../../src/ui/dom/terminal-view';
import { FakeClock, FakeMotion, RecordingLogger } from '../support/fakes';

function setup() {
  document.body.innerHTML = `
    <main id="screen">
      <div id="transcript"></div>
      <div class="input-line"><span id="prompt"></span>
        <input id="input" /><span id="cursor"></span></div>
      <div id="live"></div>
    </main>`;
  const els = findTerminalElements();
  const view = new TerminalView(els);
  const kv = new MemoryKeyValueStore();
  kv.set(SETTINGS_KEY, printSettings({ mode: '1976', speed: 'instant', crt: true }));
  const log = new RecordingLogger();
  const controller = new GameController({
    kv,
    clock: new FakeClock(1),
    motion: new FakeMotion(false),
    view,
    hooks: new ExtensionHooks(log),
    log,
  });
  installInputLine({
    input: els.input,
    cursor: document.getElementById('cursor') as HTMLElement,
    controller,
  });
  // Page load, as in main.ts.
  els.input.focus();
  controller.startBoot();
  controller.tick(0);
  return { els, controller, log };
}

/** Types one key like a browser: a disabled or unfocused input gets nothing. */
function press(input: HTMLInputElement, key: string): void {
  if (input.disabled || document.activeElement !== input) return;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  if (ev.defaultPrevented || key === 'Enter') return;
  input.value += key;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeLine(input: HTMLInputElement, text: string): void {
  for (const ch of text) press(input, ch);
  press(input, 'Enter');
}

describe('typeahead around the boot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the input enabled and focused while the boot plays', () => {
    const { els, controller } = setup();
    expect(controller.phase).toBe('booting');
    expect(els.input.disabled).toBe(false);
    expect(document.activeElement).toBe(els.input);
  });

  it('swallows only the skip key, then submits what is typed next, in order', () => {
    const { els, controller, log } = setup();
    press(els.input, ' '); // skip key during the boot
    expect(els.input.value).toBe('');
    expect(controller.phase).toBe('ready');
    expect(document.activeElement).toBe(els.input);

    // No rAF or focus step in between.
    typeLine(els.input, 'n');
    typeLine(els.input, 'in');
    controller.tick(0);

    const text = document.getElementById('transcript')?.textContent ?? '';
    expect(text).not.toContain('Please answer the question');
    expect(text).toContain('end of a road');
    expect(text).toContain('inside a building');
    expect(log.entries).toEqual([]);
    expect(document.activeElement).toBe(els.input);
  });

  it('keeps characters typed while the boot is still playing', () => {
    const { els, controller } = setup();
    // Skip, then type before anything else happens.
    press(els.input, 'x');
    typeLine(els.input, 'n');
    controller.tick(0);
    const text = document.getElementById('transcript')?.textContent ?? '';
    expect(text).toContain('end of a road');
  });
});
