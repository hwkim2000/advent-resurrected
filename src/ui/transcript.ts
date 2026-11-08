// Transcript model: a capped list of typed lines.
// Pure and DOM-free.

import { joinLines } from './event-render';
import type { LineKind, TranscriptLine } from './types';

export const MAX_TRANSCRIPT_LINES = 2000;

export class Transcript {
  private store: TranscriptLine[] = [];

  /** Append lines; the oldest lines are dropped beyond MAX_TRANSCRIPT_LINES. */
  append(lines: readonly TranscriptLine[]): void {
    for (const l of lines) this.store.push({ kind: l.kind, text: l.text, eol: l.eol });
    const excess = this.store.length - MAX_TRANSCRIPT_LINES;
    if (excess > 0) this.store.splice(0, excess);
  }

  clear(): void {
    this.store = [];
  }

  lines(): readonly TranscriptLine[] {
    return this.store;
  }

  /** Concatenated text of the `original` lines only. */
  originalText(): string {
    return joinLines(this.store.filter((l) => l.kind === 'original'));
  }

  /**
   * The last `n` lines whose kind is in `kinds` (default: every kind except
   * `boot`, which is never persisted).
   */
  tail(n: number, kinds?: readonly LineKind[]): TranscriptLine[] {
    if (n <= 0) return [];
    const allowed = kinds ?? (['original', 'input', 'notice', 'narrator'] as const);
    const picked = this.store.filter((l) => allowed.includes(l.kind));
    return picked.slice(-n).map((l) => ({ ...l }));
  }
}
