// Test doubles for the pure UI modules: clock, terminal view, motion preference, logger.
// Test support only. No browser globals.

import type {
  BlockMeta,
  Clock,
  Logger,
  Mode,
  MotionPreference,
  PromptInfo,
  TerminalPort,
  TranscriptLine,
} from '../../../src/ui/types';

/** Clock whose time is set by the test. */
export class FakeClock implements Clock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Motion preference whose value is set by the test. */
export class FakeMotion implements MotionPreference {
  constructor(public isReduced = false) {}
  reduced(): boolean {
    return this.isReduced;
  }
}

/** Every call made on a FakeTerminal, in order. */
export type TerminalCall =
  | { method: 'appendInstant'; lines: TranscriptLine[] }
  | { method: 'beginBlock'; block: BlockMeta }
  | { method: 'writeChunk'; blockId: number; chunk: string }
  | { method: 'endBlock'; block: BlockMeta }
  | { method: 'clear' }
  | { method: 'setPrompt'; info: PromptInfo }
  | { method: 'setInputEnabled'; enabled: boolean }
  | { method: 'setBusy'; busy: boolean }
  | { method: 'announce'; text: string }
  | { method: 'showMode'; selected: Mode; game: Mode | undefined }
  | { method: 'trimTo'; maxLines: number };

/** One revealed block, reassembled from its chunks. */
export interface CapturedBlock {
  id: number;
  kind: BlockMeta['kind'];
  text: string;
  /** Concatenation of the chunks actually written. */
  revealed: string;
  ended: boolean;
}

/**
 * TerminalPort that records every call and every chunk. Chunks are kept in
 * `blocks` and `chunks`, which are never trimmed, so they are outside the
 * 2000-line transcript cap.
 */
export class FakeTerminal implements TerminalPort {
  readonly calls: TerminalCall[] = [];
  readonly chunks: { blockId: number; chunk: string }[] = [];
  readonly blocks: CapturedBlock[] = [];
  readonly instantLines: TranscriptLine[] = [];
  readonly announcements: string[] = [];
  prompt: PromptInfo | undefined;
  inputEnabled = true;
  busy = false;

  appendInstant(lines: readonly TranscriptLine[]): void {
    const copy = lines.map((l) => ({ ...l }));
    this.calls.push({ method: 'appendInstant', lines: copy });
    this.instantLines.push(...copy);
  }
  beginBlock(block: BlockMeta): void {
    this.calls.push({ method: 'beginBlock', block: { ...block } });
    this.blocks.push({ id: block.id, kind: block.kind, text: block.text, revealed: '', ended: false });
  }
  writeChunk(blockId: number, chunk: string): void {
    this.calls.push({ method: 'writeChunk', blockId, chunk });
    this.chunks.push({ blockId, chunk });
    const b = this.blocks.find((x) => x.id === blockId);
    if (b) b.revealed += chunk;
  }
  endBlock(block: BlockMeta): void {
    this.calls.push({ method: 'endBlock', block: { ...block } });
    const b = this.blocks.find((x) => x.id === block.id);
    if (b) b.ended = true;
  }
  clear(): void {
    this.calls.push({ method: 'clear' });
  }
  setPrompt(info: PromptInfo): void {
    this.calls.push({ method: 'setPrompt', info: { ...info } });
    this.prompt = { ...info };
  }
  setInputEnabled(enabled: boolean): void {
    this.calls.push({ method: 'setInputEnabled', enabled });
    this.inputEnabled = enabled;
  }
  setBusy(busy: boolean): void {
    this.calls.push({ method: 'setBusy', busy });
    this.busy = busy;
  }
  announce(text: string): void {
    this.calls.push({ method: 'announce', text });
    this.announcements.push(text);
  }
  showMode(selected: Mode, game: Mode | undefined): void {
    this.calls.push({ method: 'showMode', selected, game });
  }
  trimTo(maxLines: number): void {
    this.calls.push({ method: 'trimTo', maxLines });
  }

  /** Revealed text of all blocks of the given kind, in order. */
  textOfKind(kind: BlockMeta['kind']): string {
    return this.blocks
      .filter((b) => b.kind === kind)
      .map((b) => b.revealed)
      .join('');
  }
  /** Calls of one method, in order. */
  callsOf<M extends TerminalCall['method']>(method: M): Extract<TerminalCall, { method: M }>[] {
    return this.calls.filter((c): c is Extract<TerminalCall, { method: M }> => c.method === method);
  }
}

/** Logger that records its messages. */
export class RecordingLogger implements Logger {
  readonly entries: { message: string; cause?: unknown }[] = [];
  error(message: string, cause?: unknown): void {
    this.entries.push(cause === undefined ? { message } : { message, cause });
  }
}
