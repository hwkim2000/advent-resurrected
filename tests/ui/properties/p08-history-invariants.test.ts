// Feature: crt-terminal-ui, Property 8: Command history invariants
// **Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.9**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_HISTORY, MAX_LINE, emptyHistory, pushLine, recallUp, recallDown } from '../../../src/ui/history';
import type { HistoryState } from '../../../src/ui/history';

// Small alphabet so equal and adjacent-equal lines occur often.
const arbLine: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom('', 'a', 'b', 'get lamp', 'xyzzy'), weight: 4 },
  { arbitrary: fc.string({ maxLength: 12 }), weight: 2 },
  { arbitrary: fc.string({ minLength: MAX_LINE, maxLength: MAX_LINE + 20 }), weight: 1 },
);

type Op = { kind: 'push'; line: string } | { kind: 'up'; typed: string } | { kind: 'down'; typed: string };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  arbLine.map((line): Op => ({ kind: 'push', line })),
  fc.string({ maxLength: 8 }).map((typed): Op => ({ kind: 'up', typed })),
  fc.string({ maxLength: 8 }).map((typed): Op => ({ kind: 'down', typed })),
);

// Starting histories are reached through pushLine, including ones over the cap.
const arbStart: fc.Arbitrary<HistoryState> = fc
  .array(arbLine, { maxLength: 250 })
  .map((lines) => lines.reduce(pushLine, emptyHistory()));

function checkInvariants(h: HistoryState): void {
  expect(h.entries.length).toBeLessThanOrEqual(MAX_HISTORY);
  for (let i = 0; i < h.entries.length; i++) {
    const e = h.entries[i] as string;
    expect(e).not.toBe('');
    expect(e.length).toBeLessThanOrEqual(MAX_LINE);
    if (i > 0) expect(e).not.toBe(h.entries[i - 1]);
  }
  if (h.pos !== null) {
    expect(Number.isInteger(h.pos)).toBe(true);
    expect(h.pos).toBeGreaterThanOrEqual(0);
    expect(h.pos).toBeLessThan(h.entries.length);
  }
}

describe('Property 8: Command history invariants', () => {
  it('holds for any operation sequence from any starting history', () => {
    fc.assert(
      fc.property(arbStart, fc.array(arbOp, { maxLength: 60 }), (start, ops) => {
        let h = start;
        checkInvariants(h);
        for (const op of ops) {
          const before = h;
          if (op.kind === 'push') {
            h = pushLine(h, op.line);
            expect(h.pos).toBeNull();
            // 8.1: a non-empty line differing from the newest entry becomes the newest entry.
            const text = op.line.slice(0, MAX_LINE);
            const newest = before.entries[before.entries.length - 1];
            if (text !== '' && text !== newest) {
              expect(h.entries[h.entries.length - 1]).toBe(text);
            } else {
              expect(h.entries).toEqual(before.entries);
            }
          } else if (op.kind === 'up') {
            const r = recallUp(h, op.typed);
            h = r.h;
            if (before.entries.length > 0) {
              expect(h.pos).not.toBeNull();
              expect(r.text).toBe(h.entries[h.pos as number]);
              // 8.2: Up at the oldest entry stays on it.
              if (before.pos === 0) {
                expect(h.pos).toBe(0);
                expect(r.text).toBe(before.entries[0]);
              }
            }
          } else {
            h = recallDown(h, op.typed).h;
          }
          expect(h.entries.length).toBeLessThanOrEqual(MAX_HISTORY);
          checkInvariants(h);
        }
      }),
      { numRuns: 200 },
    );
  });
});
