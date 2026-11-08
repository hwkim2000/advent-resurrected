// Turns engine events into Original_Text and transcript lines.
// Pure: imports the engine's public API only.

import { render } from '../engine/index';
import type { OutputEvent } from '../engine/index';
import type { LineKind, PromptInfo, TranscriptLine } from './types';

/** Original_Text of one engine call: `render(events, { echo: false })`. */
export function originalTextOf(events: readonly OutputEvent[]): string {
  return render(events, { echo: false });
}

/** The last `prompt` event of a sequence, if any. */
export function lastPromptOf(events: readonly OutputEvent[]): PromptInfo | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'prompt') return { kind: e.kind, text: e.text };
  }
  return undefined;
}

/**
 * Split text on '\n' into lines carrying an `eol` flag.
 * 'a\nb' -> [{a, eol:true}, {b, eol:false}]; 'a\n' -> [{a, eol:true}];
 * '' -> [].
 */
export function splitIntoLines(text: string, kind: LineKind): TranscriptLine[] {
  if (text === '') return [];
  const parts = text.split('\n');
  const lines: TranscriptLine[] = [];
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    if (last) {
      // Text ending in '\n' leaves an empty final part: no partial line.
      if (parts[i] !== '') lines.push({ kind, text: parts[i]!, eol: false });
    } else {
      lines.push({ kind, text: parts[i]!, eol: true });
    }
  }
  return lines;
}

/** Inverse of `splitIntoLines`: restores the exact original bytes. */
export function joinLines(lines: readonly TranscriptLine[]): string {
  let out = '';
  for (const l of lines) out += l.text + (l.eol ? '\n' : '');
  return out;
}
