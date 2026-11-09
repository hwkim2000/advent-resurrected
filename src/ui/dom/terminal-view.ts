// DOM implementation of TerminalPort. Text is written only through Text nodes
// (never innerHTML), so engine strings are never interpreted as markup.

import type {
  BlockMeta,
  LineKind,
  Mode,
  PromptInfo,
  TerminalPort,
  TranscriptLine,
} from '../types';
import { shouldStick } from './viewport';

export interface TerminalViewElements {
  transcript: HTMLElement;
  prompt: HTMLElement;
  input: HTMLInputElement;
  live: HTMLElement;
  /** Second polite live region for "Interpreted as ..."; falls back to `live`. */
  liveInterpreted?: HTMLElement;
  /** Receives data-selected-mode / data-game-mode. Defaults to the document element. */
  root: HTMLElement;
}

/** Looks the elements up by the ids used in index.html. */
export function findTerminalElements(doc: Document = document): TerminalViewElements {
  const need = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
  };
  return {
    transcript: need('transcript'),
    prompt: need('prompt'),
    input: need<HTMLInputElement>('input'),
    live: need('live'),
    ...(doc.getElementById('live-interpreted')
      ? { liveInterpreted: need('live-interpreted') }
      : {}),
    root: doc.documentElement,
  };
}

export class TerminalView implements TerminalPort {
  private readonly els: TerminalViewElements;
  private readonly doc: Document;
  /** Line element currently receiving streamed chunks, if any. */
  private current: { el: HTMLElement; text: Text } | null = null;
  private blockKind: LineKind = 'original';
  private stick = true;
  /** The pending-indicator line, always the last child while shown. */
  private pendingEl: HTMLElement | null = null;

  constructor(els?: TerminalViewElements, doc: Document = document) {
    this.doc = doc;
    this.els = els ?? findTerminalElements(doc);
  }

  appendInstant(lines: readonly TranscriptLine[]): void {
    this.beginMutation();
    this.current = null;
    for (const line of lines) this.makeLine(line.kind, line.text);
    this.endMutation();
  }

  beginBlock(block: BlockMeta): void {
    this.blockKind = block.kind;
    this.current = null;
  }

  writeChunk(_blockId: number, chunk: string): void {
    if (chunk === '') return;
    this.beginMutation();
    const parts = chunk.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      if (part !== '') {
        if (this.current) this.current.text.appendData(part);
        else this.current = this.makeLine(this.blockKind, part);
      }
      if (i < parts.length - 1) {
        // A newline terminates the line; a blank line is created if none is open.
        if (!this.current) this.makeLine(this.blockKind, '');
        this.current = null;
      }
    }
    this.endMutation();
  }

  endBlock(_block: BlockMeta): void {
    this.current = null;
  }

  clear(): void {
    this.current = null;
    this.pendingEl = null;
    this.els.transcript.replaceChildren();
    this.els.live.replaceChildren();
    this.els.liveInterpreted?.replaceChildren();
    this.stick = true;
  }

  trimTo(maxLines: number): void {
    const t = this.els.transcript;
    const max = Math.max(0, Math.floor(maxLines));
    const extra = this.pendingEl ? 1 : 0;
    while (t.childElementCount - extra > max) {
      const first = t.firstElementChild;
      if (!first || first === this.pendingEl) break;
      if (this.current && this.current.el === first) this.current = null;
      first.remove();
    }
  }

  setPrompt(info: PromptInfo): void {
    this.els.prompt.textContent = info.text;
  }

  setInputEnabled(enabled: boolean): void {
    this.els.input.disabled = !enabled;
  }

  setBusy(busy: boolean): void {
    if (busy) this.els.transcript.setAttribute('aria-hidden', 'true');
    else this.els.transcript.removeAttribute('aria-hidden');
  }

  showPending(): void {
    if (this.pendingEl) return;
    this.beginMutation();
    const el = this.doc.createElement('div');
    el.className = 'line line--pending';
    this.els.transcript.appendChild(el);
    this.pendingEl = el;
    this.endMutation();
  }

  hidePending(): void {
    if (!this.pendingEl) return;
    this.pendingEl.remove();
    this.pendingEl = null;
  }

  announceInterpretation(command: string): void {
    const region = this.els.liveInterpreted ?? this.els.live;
    region.textContent = `Interpreted as ${command}`;
  }

  announce(text: string): void {
    // One whole block per announcement; replace the previous one.
    this.els.live.textContent = text;
  }

  showMode(selected: Mode, game: Mode | undefined): void {
    const ds = this.els.root.dataset;
    ds['selectedMode'] = selected;
    if (game === undefined) delete ds['gameMode'];
    else ds['gameMode'] = game;
  }

  private makeLine(kind: LineKind, text: string): { el: HTMLElement; text: Text } {
    const el = this.doc.createElement('div');
    el.className = `line line--${kind}`;
    const node = this.doc.createTextNode(text);
    // An empty Text node would defeat :empty, so only attach non-empty text.
    if (text !== '') el.appendChild(node);
    // New lines go before the pending indicator so it stays last.
    if (this.pendingEl && this.pendingEl.parentNode === this.els.transcript) {
      this.els.transcript.insertBefore(el, this.pendingEl);
    } else {
      this.els.transcript.appendChild(el);
    }
    return { el, text: node };
  }

  private beginMutation(): void {
    const t = this.els.transcript;
    this.stick = shouldStick({
      scrollTop: t.scrollTop,
      clientHeight: t.clientHeight,
      scrollHeight: t.scrollHeight,
    });
  }

  private endMutation(): void {
    const t = this.els.transcript;
    if (this.stick) t.scrollTop = t.scrollHeight;
  }
}
