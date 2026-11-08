// Input line glue: a real <input> with a transparent caret, a separate block
// cursor positioned in `ch` units, history keys, boot skip and Teletype flush.
// Uses the DOM; all behavior lives in the GameController.

import type { GameController } from '../game-controller';

export interface InputLineOptions {
  input: HTMLInputElement;
  /** The block cursor element; positioned via style.left. */
  cursor: HTMLElement;
  /** Tapping this element focuses the input when no text is selected. */
  screen?: HTMLElement | null;
  controller: Pick<GameController, 'submit' | 'skip' | 'history' | 'phase'>;
  /** True while the Teletype is revealing text; when omitted, skip() runs on every key. */
  isBusy?: () => boolean;
  doc?: Document;
}

export const MAX_INPUT_CHARS = 1023;

/** `calc()` expression for the block cursor's left offset (Requirement 7.8). */
export function cursorLeft(caretIndex: number, scrollLeft: number): string {
  return `calc(${caretIndex} * 1ch - ${scrollLeft}px)`;
}

/** Applies the attributes that keep mobile keyboards from interfering. */
export function configureInput(input: HTMLInputElement): void {
  input.type = 'text';
  input.maxLength = MAX_INPUT_CHARS;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('enterkeyhint', 'send');
  input.setAttribute('inputmode', 'text');
}

/** Wires the input line; returns a disposer. */
export function installInputLine(opts: InputLineOptions): () => void {
  const { input, cursor, screen, controller } = opts;
  const doc = opts.doc ?? input.ownerDocument;
  configureInput(input);

  const updateCursor = (): void => {
    const pos = input.selectionStart ?? input.value.length;
    cursor.style.left = cursorLeft(pos, input.scrollLeft);
  };

  const moveCaretToEnd = (): void => {
    const end = input.value.length;
    input.setSelectionRange(end, end);
    updateCursor();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    if (controller.phase === 'booting') {
      controller.skip();
      e.preventDefault();
      return;
    }
    if (opts.isBusy === undefined || opts.isBusy()) controller.skip();

    if (e.key === 'Enter') {
      e.preventDefault();
      const value = input.value;
      input.value = '';
      controller.history.reset();
      controller.submit(value);
      updateCursor();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      input.value =
        e.key === 'ArrowUp'
          ? controller.history.up(input.value)
          : controller.history.down(input.value);
      moveCaretToEnd();
    }
  };

  const onScreenClick = (): void => {
    const sel = doc.getSelection?.();
    if (sel && !sel.isCollapsed) return;
    if (!input.disabled) input.focus();
  };

  const events = ['input', 'keyup', 'click', 'select'] as const;
  input.addEventListener('keydown', onKeyDown);
  for (const ev of events) input.addEventListener(ev, updateCursor);
  doc.addEventListener('selectionchange', updateCursor);
  screen?.addEventListener('click', onScreenClick);
  updateCursor();

  return () => {
    input.removeEventListener('keydown', onKeyDown);
    for (const ev of events) input.removeEventListener(ev, updateCursor);
    doc.removeEventListener('selectionchange', updateCursor);
    screen?.removeEventListener('click', onScreenClick);
  };
}
