// Feature: crt-terminal-ui, Property 1: Rendering fidelity and Original_Text immutability
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render } from '../../../src/engine/index';
import { originalTextOf, splitIntoLines, joinLines } from '../../../src/ui/event-render';
import { Transcript, MAX_TRANSCRIPT_LINES } from '../../../src/ui/transcript';
import type { LineKind, TranscriptLine } from '../../../src/ui/types';
import { arbOutputEvent, arbTranscriptLine } from '../support/generators';

const NON_ORIGINAL: readonly LineKind[] = ['input', 'notice', 'narrator', 'boot'];

// Keep the total well under MAX_TRANSCRIPT_LINES so nothing is trimmed.
const arbCall = fc.record({
  events: fc.array(arbOutputEvent, { maxLength: 6 }),
  before: fc.array(
    arbTranscriptLine.map((l): TranscriptLine => ({ ...l, kind: NON_ORIGINAL[l.text.length % 4]! })),
    { maxLength: 4 },
  ),
  after: fc.array(
    arbTranscriptLine.map((l): TranscriptLine => ({ ...l, kind: NON_ORIGINAL[(l.text.length + 1) % 4]! })),
    { maxLength: 4 },
  ),
});

const originalLines = (t: Transcript): TranscriptLine[] =>
  t.lines().filter((l) => l.kind === 'original').map((l) => ({ ...l }));

describe('Property 1: Rendering fidelity and Original_Text immutability', () => {
  /** **Validates: Requirements 5.1, 5.2, 5.6, 5.8, 12.4, 12.7** */
  it('original lines equal the concatenated render output, whatever is interleaved', () => {
    fc.assert(
      fc.property(fc.array(arbCall, { maxLength: 5 }), (calls) => {
        const t = new Transcript();
        let expected = '';
        for (const call of calls) {
          t.append(call.before);
          const text = originalTextOf(call.events);
          expect(text).toBe(render(call.events, { echo: false }));
          expected += text;

          t.append(splitIntoLines(text, 'original'));
          // Non-original appends leave the original lines untouched.
          const mid = originalLines(t);
          t.append(call.after);
          expect(originalLines(t)).toEqual(mid);
        }
        expect(t.lines().length).toBeLessThanOrEqual(MAX_TRANSCRIPT_LINES);
        expect(t.originalText()).toBe(expected);
        expect(joinLines(originalLines(t))).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('non-text events contribute nothing', () => {
    fc.assert(
      fc.property(fc.array(arbOutputEvent, { maxLength: 12 }), (events) => {
        const nonText = events.filter((e) => e.type !== 'text' && e.type !== 'prompt' && e.type !== 'game-over');
        expect(originalTextOf(nonText)).toBe('');
      }),
      { numRuns: 100 },
    );
  });
});
