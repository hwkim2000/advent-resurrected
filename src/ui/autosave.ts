// Autosave: encode/decode the serialized game state plus the recent transcript
// into one KeyValueStore entry. Pure and DOM-free; every decode path is total.

import { deserialize, serialize } from '../engine/index';
import type { GameState } from '../engine/index';
import { AUTOSAVE_KEY } from './save-store';
import type { KeyValueStore, LineKind, PromptInfo, TranscriptLine } from './types';

export const AUTOSAVE_MAX_CHARS = 400_000;
export const AUTOSAVE_MAX_LINES = 200;

/** Most Deflections counted per game (Requirement 13.11). */
export const DEFLECTION_LIMIT = 1;

export interface AutosaveRecord {
  v: 1;
  state: string;
  prompt: PromptInfo;
  lines: TranscriptLine[];
  /** Present only when deflections > 0. */
  ui?: { deflections: number };
}

export interface Restored {
  state: GameState;
  prompt: PromptInfo;
  lines: TranscriptLine[];
  deflections: number;
}

/** Kinds persisted in the autosave tail (never `boot`). */
export const AUTOSAVE_LINE_KINDS: readonly LineKind[] = [
  'original',
  'input',
  'translation',
  'notice',
  'narrator',
];

const LINE_KINDS: readonly LineKind[] = [
  'original',
  'input',
  'translation',
  'notice',
  'narrator',
  'boot',
];
const PROMPT_KINDS: readonly string[] = ['command', 'yesno', 'filename'];

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isLine(x: unknown): x is TranscriptLine {
  return (
    isObject(x) &&
    typeof x.kind === 'string' &&
    (LINE_KINDS as readonly string[]).includes(x.kind) &&
    typeof x.text === 'string' &&
    typeof x.eol === 'boolean'
  );
}

function isPrompt(x: unknown): x is PromptInfo {
  return (
    isObject(x) &&
    typeof x.kind === 'string' &&
    PROMPT_KINDS.includes(x.kind) &&
    typeof x.text === 'string'
  );
}

/**
 * Encode a running game. Keeps the last AUTOSAVE_MAX_LINES non-boot lines and
 * drops the oldest lines until the JSON fits `maxChars`. Returns undefined if
 * the state alone does not fit.
 */
export function encodeAutosave(
  state: GameState,
  prompt: PromptInfo,
  lines: readonly TranscriptLine[],
  maxChars: number = AUTOSAVE_MAX_CHARS,
  deflections = 0,
): string | undefined {
  const stateText = serialize(state);
  let kept = lines
    .filter((l) => l.kind !== 'boot')
    .slice(-AUTOSAVE_MAX_LINES)
    .map((l) => ({ kind: l.kind, text: l.text, eol: l.eol }));
  const build = (ls: TranscriptLine[]): string => {
    const rec: AutosaveRecord = {
      v: 1,
      state: stateText,
      prompt: { kind: prompt.kind, text: prompt.text },
      lines: ls,
    };
    if (deflections > 0) rec.ui = { deflections };
    return JSON.stringify(rec);
  };
  let json = build(kept);
  while (json.length > maxChars && kept.length > 0) {
    // Drop oldest lines first, in growing batches to stay fast.
    const drop = Math.max(1, Math.ceil(kept.length / 8));
    kept = kept.slice(drop);
    json = build(kept);
  }
  return json.length > maxChars ? undefined : json;
}

/** Total: returns undefined for anything that is not a valid, running autosave. */
export function decodeAutosave(text: string | null): Restored | undefined {
  if (text === null || typeof text !== 'string') return undefined;
  try {
    const rec: unknown = JSON.parse(text);
    if (!isObject(rec) || rec.v !== 1 || typeof rec.state !== 'string') return undefined;
    if (!isPrompt(rec.prompt)) return undefined;
    if (!Array.isArray(rec.lines) || !rec.lines.every(isLine)) return undefined;
    const result = deserialize(rec.state);
    if (!result.ok) return undefined;
    if (result.state.session.status !== 'running') return undefined;
    let deflections = 0;
    const ui = rec.ui;
    if (isObject(ui)) {
      const d = ui.deflections;
      if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= DEFLECTION_LIMIT) {
        deflections = d;
      }
    }
    return {
      state: result.state,
      prompt: { kind: rec.prompt.kind, text: rec.prompt.text },
      lines: rec.lines.map((l) => ({ kind: l.kind, text: l.text, eol: l.eol })),
      deflections,
    };
  } catch {
    return undefined;
  }
}

function safeGet(kv: KeyValueStore): string | null {
  try {
    return kv.get(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

function safeRemove(kv: KeyValueStore): void {
  try {
    kv.remove(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Load the autosave; an entry that exists but is invalid is removed. */
export function loadAutosave(kv: KeyValueStore): Restored | undefined {
  const text = safeGet(kv);
  if (text === null) return undefined;
  const restored = decodeAutosave(text);
  if (restored === undefined) safeRemove(kv);
  return restored;
}

/** Write the autosave. Leaves any previous entry if it cannot be encoded; never throws. */
export function storeAutosave(
  kv: KeyValueStore,
  state: GameState,
  prompt: PromptInfo,
  lines: readonly TranscriptLine[],
  maxChars: number = AUTOSAVE_MAX_CHARS,
  deflections = 0,
): void {
  const json = encodeAutosave(state, prompt, lines, maxChars, deflections);
  if (json === undefined) return;
  try {
    kv.set(AUTOSAVE_KEY, json);
  } catch {
    /* ignore: ResilientStore normally prevents this */
  }
}

export function clearAutosave(kv: KeyValueStore): void {
  safeRemove(kv);
}
