// @vitest-environment happy-dom
// Feature: voice-input, task 9.4: core DOM tests for the Mic_Button.
// Uses the real src/ui/dom/mic-button.ts, the real index.html markup and a fake VoicePort.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMicButton, type MicElements, type MicHandle } from '../../../src/ui/dom/mic-button';
import type {
  GestureReply,
  VoiceAvailability,
  VoiceGestureEvent,
  VoicePort,
  VoiceViewState,
} from '../../../src/ui/voice-port';

const AVAILABILITIES: VoiceAvailability[] = [
  'Unsupported',
  'Ready',
  'Busy',
  'Suspended',
  'Unavailable',
];

function view(over: Partial<VoiceViewState> = {}): VoiceViewState {
  return {
    availability: 'Ready',
    pressed: false,
    disabled: false,
    status: '',
    announcement: null,
    ...over,
  };
}

class FakePort implements VoicePort {
  events: VoiceGestureEvent[] = [];
  current: VoiceViewState;
  private listeners = new Set<(v: VoiceViewState) => void>();
  constructor(initial: VoiceViewState = view()) {
    this.current = initial;
  }
  getView(): VoiceViewState {
    return this.current;
  }
  onView(listener: (v: VoiceViewState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispatch(event: VoiceGestureEvent): GestureReply {
    this.events.push(event);
    return { preventDefault: false };
  }
  emit(v: VoiceViewState): void {
    this.current = v;
    for (const l of [...this.listeners]) l(v);
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

/** Body markup of the real index.html, without scripts. */
function loadIndexBody(): string {
  // Drop the stylesheet link so happy-dom does not try to load it.
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8').replace(
    /<link\b[^>]*>/g,
    '',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, noscript').forEach((n) => n.remove());
  return parsed.body.innerHTML;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function collectEls(): MicElements {
  return {
    button: byId<HTMLButtonElement>('mic'),
    status: byId('voice-status'),
    disclosure: byId('mic-disclosure'),
    unavailable: byId('mic-unavailable'),
    live: byId('voice-live'),
    input: byId<HTMLInputElement>('input'),
  };
}

function ptr(type: string, pointerType: string, over: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    pointerType,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...over,
  });
}

function click(detail: number): MouseEvent {
  return new MouseEvent('click', { detail, bubbles: true, cancelable: true });
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
}

let els: MicElements;
let handle: MicHandle;
let port: FakePort;
let deferred: Array<() => void>;

function mount(initial: VoiceViewState = view()): void {
  document.body.innerHTML = loadIndexBody();
  els = collectEls();
  deferred = [];
  handle = installMicButton({ els, doc: document, defer: (fn) => deferred.push(fn) });
  port = new FakePort(initial);
  handle.attach(port);
}

function selectInput(): void {
  els.input.value = 'open door';
  els.input.focus();
  els.input.setSelectionRange(2, 6);
}

function expectInputUntouched(): void {
  expect(document.activeElement).toBe(els.input);
  expect(els.input.value).toBe('open door');
  expect(els.input.selectionStart).toBe(2);
  expect(els.input.selectionEnd).toBe(6);
}

beforeEach(() => {
  vi.useFakeTimers();
  mount();
});

afterEach(() => {
  handle.dispose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Mic_Button view-state table', () => {
  for (const availability of AVAILABILITIES) {
    for (const pressed of [false, true]) {
      for (const disabled of [false, true]) {
        it(`${availability} pressed=${pressed} disabled=${disabled}`, () => {
          port.emit(view({ availability, pressed, disabled }));
          const usable = availability === 'Ready' || availability === 'Busy';
          const { button, disclosure, status } = els;

          expect(button.hidden).toBe(!usable);
          expect(button.hasAttribute('hidden')).toBe(!usable);
          expect(disclosure.hidden).toBe(!usable);
          expect(disclosure.hasAttribute('hidden')).toBe(!usable);
          expect(button.getAttribute('aria-pressed')).toBe(String(pressed));
          expect(button.getAttribute('aria-disabled')).toBe(disabled ? 'true' : null);
          expect(button.getAttribute('aria-describedby')).toBe(
            disabled ? 'mic-disclosure mic-unavailable' : 'mic-disclosure',
          );
          expect(button.textContent).toBe(pressed ? 'MIC ON' : 'MIC');
          expect(button.getAttribute('aria-keyshortcuts')).toBe('Alt+M');
          expect(button.getAttribute('aria-label')).toBe('Mic: hold to talk');
          expect(disclosure.hasAttribute('aria-hidden')).toBe(false);
          expect(status.getAttribute('aria-hidden')).toBe('true');
        });
      }
    }
  }

  it('shows Voice_Status text through textContent and hides it when empty', () => {
    port.emit(view({ status: 'LISTENING...' }));
    expect(els.status.textContent).toBe('LISTENING...');
    expect(els.status.hidden).toBe(false);
    port.emit(view({ status: '' }));
    expect(els.status.textContent).toBe('');
    expect(els.status.hidden).toBe(true);
  });

  it('keeps everything hidden and inert until a port is attached', () => {
    handle.dispose();
    document.body.innerHTML = loadIndexBody();
    els = collectEls();
    handle = installMicButton({ els, doc: document, defer: () => {} });
    expect(els.button.hidden).toBe(true);
    expect(els.disclosure.hidden).toBe(true);
    expect(() => {
      els.button.dispatchEvent(ptr('pointerdown', 'mouse'));
      els.button.dispatchEvent(click(0));
      document.dispatchEvent(key('keydown', { code: 'KeyM', altKey: true }));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    }).not.toThrow();
    expect(els.button.hidden).toBe(true);
  });
});

describe('mouse and pen press', () => {
  for (const pointerType of ['mouse', 'pen'] as const) {
    for (const holdMs of [249, 250]) {
      it(`${pointerType} hold of ${holdMs} ms dispatches pointer-down then pointer-up`, () => {
        els.button.dispatchEvent(ptr('pointerdown', pointerType));
        vi.advanceTimersByTime(holdMs);
        els.button.dispatchEvent(ptr('pointerup', pointerType));
        expect(port.events).toEqual([
          { type: 'pointer-down', pointerType },
          { type: 'pointer-up', pointerType },
        ]);
      });
    }

    it(`${pointerType} click with detail > 0 after a press is ignored`, () => {
      els.button.dispatchEvent(ptr('pointerdown', pointerType));
      els.button.dispatchEvent(ptr('pointerup', pointerType));
      els.button.dispatchEvent(click(1));
      expect(port.types()).toEqual(['pointer-down', 'pointer-up']);
    });

    it(`${pointerType} pointercancel is forwarded`, () => {
      els.button.dispatchEvent(ptr('pointerdown', pointerType));
      els.button.dispatchEvent(ptr('pointercancel', pointerType));
      expect(port.events[1]).toEqual({ type: 'pointer-cancel', pointerType });
    });
  }

  it('ignores a non-primary or non-left press', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'mouse', { button: 2 }));
    els.button.dispatchEvent(ptr('pointerdown', 'touch', { isPrimary: false }));
    expect(port.events).toEqual([]);
  });
});

describe('touch press and Touch_Click', () => {
  it('touch pointerdown and pointerup are dispatched (the layer ignores them) and start nothing', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(ptr('pointerup', 'touch'));
    expect(port.events).toEqual([
      { type: 'pointer-down', pointerType: 'touch' },
      { type: 'pointer-up', pointerType: 'touch' },
    ]);
    expect(port.types()).not.toContain('button-activate');
  });

  it('a click after a touch pointerdown dispatches exactly one button-activate via touch', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(ptr('pointerup', 'touch'));
    els.button.dispatchEvent(click(1));
    const activates = port.events.filter((e) => e.type === 'button-activate');
    expect(activates).toEqual([{ type: 'button-activate', via: 'touch' }]);
  });

  it('the next touch tap dispatches one more button-activate', () => {
    for (let i = 0; i < 2; i++) {
      els.button.dispatchEvent(ptr('pointerdown', 'touch'));
      els.button.dispatchEvent(ptr('pointerup', 'touch'));
      els.button.dispatchEvent(click(1));
    }
    expect(port.events.filter((e) => e.type === 'button-activate')).toHaveLength(2);
  });

  it('a second click without a new touch press is ignored (pressType resets after click)', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(click(1));
    els.button.dispatchEvent(click(1));
    expect(port.events.filter((e) => e.type === 'button-activate')).toHaveLength(1);
  });

  it('a touch long press ending in contextmenu starts nothing', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
    els.button.dispatchEvent(ptr('pointercancel', 'touch'));
    els.button.dispatchEvent(click(1));
    expect(port.events.filter((e) => e.type === 'button-activate')).toEqual([]);
  });

  it('a click with detail 0 is a keyboard activation', () => {
    els.button.dispatchEvent(click(0));
    expect(port.events).toEqual([{ type: 'button-activate', via: 'keyboard' }]);
  });

  it('a click with detail 0 right after a touch press is still keyboard', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(click(0));
    expect(port.events.filter((e) => e.type === 'button-activate')).toEqual([
      { type: 'button-activate', via: 'keyboard' },
    ]);
  });
});

describe('default prevention', () => {
  it('prevents contextmenu', () => {
    const e = new Event('contextmenu', { bubbles: true, cancelable: true });
    els.button.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  for (const pointerType of ['mouse', 'pen', 'touch']) {
    it(`prevents default on a ${pointerType} pointerdown`, () => {
      const e = ptr('pointerdown', pointerType);
      els.button.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
  }

  it('prevents default on a compatibility mousedown after a touch press', () => {
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    els.button.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('focus, value and selection stay put', () => {
  for (const pointerType of ['mouse', 'pen', 'touch']) {
    it(`unchanged after a ${pointerType} press and release`, () => {
      selectInput();
      els.button.dispatchEvent(ptr('pointerdown', pointerType));
      els.button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      els.button.dispatchEvent(ptr('pointerup', pointerType));
      expectInputUntouched();
    });
  }

  it('restores the input when the press moved focus to the button', () => {
    selectInput();
    els.button.hidden = false;
    els.button.dispatchEvent(ptr('pointerdown', 'mouse'));
    // A real browser would have focused the button on mousedown; simulate the leak.
    els.button.focus();
    els.button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(els.input);
    expect(els.input.value).toBe('open door');
    expect(els.input.selectionStart).toBe(2);
    expect(els.input.selectionEnd).toBe(6);
  });

  it('unchanged after a touch click', () => {
    selectInput();
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.dispatchEvent(ptr('pointerup', 'touch'));
    els.button.dispatchEvent(click(1));
    expectInputUntouched();
  });

  it('restores the input after a touch click that left focus on the button', () => {
    selectInput();
    els.button.dispatchEvent(ptr('pointerdown', 'touch'));
    els.button.focus();
    els.button.dispatchEvent(click(1));
    expect(document.activeElement).toBe(els.input);
    expect(els.input.value).toBe('open door');
    expect(els.input.selectionStart).toBe(2);
    expect(els.input.selectionEnd).toBe(6);
  });
});

describe('Alt+M and other keys', () => {
  it('prevents default and dispatches altm-down', () => {
    const e = key('keydown', { code: 'KeyM', altKey: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(port.events).toEqual([{ type: 'altm-down', repeat: false }]);
  });

  it('prevents default also on repeat and reports repeat', () => {
    const e = key('keydown', { code: 'KeyM', altKey: true, repeat: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(port.events).toEqual([{ type: 'altm-down', repeat: true }]);
  });

  it('prevents default while Busy', () => {
    port.emit(view({ availability: 'Busy' }));
    const e = key('keydown', { code: 'KeyM', altKey: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  for (const mod of ['ctrlKey', 'metaKey', 'shiftKey'] as const) {
    it(`ignores Alt+M combined with ${mod}`, () => {
      const e = key('keydown', { code: 'KeyM', altKey: true, [mod]: true });
      document.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(port.events).toEqual([]);
    });
  }

  it('ignores M without Alt', () => {
    const e = key('keydown', { code: 'KeyM' });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(port.events).toEqual([]);
  });

  it('does not intercept Alt+M while Unavailable', () => {
    port.emit(view({ availability: 'Unavailable' }));
    const e = key('keydown', { code: 'KeyM', altKey: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(port.events).toEqual([]);
  });

  it('dispatches altm-up on keyup of M', () => {
    document.dispatchEvent(key('keyup', { code: 'KeyM' }));
    expect(port.events).toEqual([{ type: 'altm-up' }]);
  });

  it('dispatches escape only while a session is running, without preventDefault', () => {
    const idle = key('keydown', { key: 'Escape', code: 'Escape' });
    document.dispatchEvent(idle);
    expect(port.events).toEqual([]);
    port.emit(view({ pressed: true }));
    const running = key('keydown', { key: 'Escape', code: 'Escape' });
    document.dispatchEvent(running);
    expect(port.events).toEqual([{ type: 'escape' }]);
    expect(running.defaultPrevented).toBe(false);
  });
});

describe('page and window signals', () => {
  it('dispatches window-blur, page-hidden and pagehide from the events themselves', () => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    expect(port.types()).toEqual(['window-blur', 'page-hidden', 'pagehide']);
  });
});

describe('start-failure hiding', () => {
  it('hides button and disclosure together and moves focus to the input unchanged', () => {
    port.emit(view({ availability: 'Ready' }));
    selectInput();
    els.button.focus();
    expect(document.activeElement).toBe(els.button);
    // restore the input's caret as a real browser keeps it while the button has focus
    els.input.setSelectionRange(2, 6);

    port.emit(view({ availability: 'Unavailable', status: 'VOICE IS NOT AVAILABLE. KEEP TYPING.' }));

    expect(els.button.hidden).toBe(true);
    expect(els.disclosure.hidden).toBe(true);
    expect(document.activeElement).toBe(els.input);
    expect(els.input.value).toBe('open door');
    expect(els.input.selectionStart).toBe(2);
    expect(els.input.selectionEnd).toBe(6);
    expect(els.status.textContent).toBe('VOICE IS NOT AVAILABLE. KEEP TYPING.');
    expect(els.status.hidden).toBe(false);
  });

  it('does not steal focus from elsewhere when the button is not focused', () => {
    els.input.focus();
    port.emit(view({ availability: 'Unavailable' }));
    expect(document.activeElement).toBe(els.input);
    expect(els.button.hidden).toBe(true);
  });
});

describe('Voice_Live_Region', () => {
  it('announces new text and re-arms identical text through defer', () => {
    port.emit(view({ announcement: { seq: 1, text: 'NOTHING HEARD.' } }));
    expect(els.live.textContent).toBe('NOTHING HEARD.');
    port.emit(view({ announcement: { seq: 2, text: 'NOTHING HEARD.' } }));
    expect(els.live.textContent).toBe('');
    expect(deferred).toHaveLength(1);
    deferred[0]?.();
    expect(els.live.textContent).toBe('NOTHING HEARD.');
  });
});

describe('robustness', () => {
  it('with an unattached port nothing throws and typing is unaffected', () => {
    handle.dispose();
    document.body.innerHTML = loadIndexBody();
    const fresh = collectEls();
    const h = installMicButton({ els: fresh, doc: document, defer: () => {} });
    fresh.input.value = 'look';
    fresh.input.focus();
    expect(() => {
      fresh.button.dispatchEvent(ptr('pointerdown', 'touch'));
      fresh.button.dispatchEvent(click(1));
      document.dispatchEvent(key('keydown', { code: 'KeyM', altKey: true }));
    }).not.toThrow();
    expect(fresh.input.value).toBe('look');
    expect(document.activeElement).toBe(fresh.input);
    h.dispose();
  });

  it('with a missing element installs nothing and returns a no-op handle', () => {
    handle.dispose();
    document.body.innerHTML = loadIndexBody();
    const partial = collectEls();
    const broken = { ...partial, live: undefined } as unknown as MicElements;
    const h = installMicButton({ els: broken, doc: document });
    const p = new FakePort();
    expect(() => {
      h.attach(p);
      partial.button.dispatchEvent(ptr('pointerdown', 'mouse'));
      document.dispatchEvent(key('keydown', { code: 'KeyM', altKey: true }));
      h.dispose();
    }).not.toThrow();
    expect(p.events).toEqual([]);
    expect(partial.button.hidden).toBe(true);
  });

  it('after dispose, gestures dispatch nothing and everything is hidden', () => {
    port.emit(view());
    handle.dispose();
    els.button.dispatchEvent(ptr('pointerdown', 'mouse'));
    document.dispatchEvent(key('keydown', { code: 'KeyM', altKey: true }));
    expect(port.events).toEqual([]);
    expect(els.button.hidden).toBe(true);
    expect(els.disclosure.hidden).toBe(true);
  });
});
