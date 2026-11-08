// Ports and shared types for the CRT terminal UI.
// Pure types only: no browser globals. Imports the engine's public API only.

import type { OutputEvent } from '../engine/index';

/** Prompt kinds carried by the engine's `prompt` events. */
export type PromptKind = Extract<OutputEvent, { type: 'prompt' }>['kind'];

export type Mode = '1976' | 'haunted';
export type Speed = 20 | 60 | 120 | 300 | 'instant';
export type LineKind = 'original' | 'input' | 'notice' | 'narrator' | 'boot';

export interface TranscriptLine {
  kind: LineKind;
  text: string;
  /** True when the line ended with a newline in the source text. */
  eol: boolean;
}

/** localStorage-shaped store; any method may throw. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Millisecond clock; the game seed is `now() | 0`. */
export interface Clock {
  now(): number;
}

export interface MotionPreference {
  reduced(): boolean;
}

export interface Logger {
  error(message: string, cause?: unknown): void;
}

export interface PromptInfo {
  kind: PromptKind;
  text: string;
}

/** Identifies a block of text being revealed by the Teletype. */
export interface BlockMeta {
  id: number;
  kind: LineKind;
  text: string;
}

/** What the GameController needs from the terminal view. */
export interface TerminalPort {
  /** Input echo, restored transcript. Shown at once. */
  appendInstant(lines: readonly TranscriptLine[]): void;
  /** Teletype sink. */
  beginBlock(block: BlockMeta): void;
  /** Teletype sink. */
  writeChunk(blockId: number, chunk: string): void;
  /** Teletype sink. */
  endBlock(block: BlockMeta): void;
  clear(): void;
  setPrompt(info: PromptInfo): void;
  setInputEnabled(enabled: boolean): void;
  /** Toggles aria-hidden on the animated transcript. */
  setBusy(busy: boolean): void;
  /** Writes to the aria-live region. */
  announce(text: string): void;
  showMode(selected: Mode, game: Mode | undefined): void;
  trimTo(maxLines: number): void;
}
