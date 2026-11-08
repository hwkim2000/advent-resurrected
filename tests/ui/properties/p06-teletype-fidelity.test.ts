// Feature: crt-terminal-ui, Property 6: Teletype reveals exactly the output text
// **Validates: Requirements 4.10, 6.5, 6.6, 6.7, 6.9**

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { Teletype, type TeletypeBlock } from '../../../src/ui/teletype';
import type { BlockMeta, Speed } from '../../../src/ui/types';
import { FakeMotion, FakeTerminal } from '../support/fakes';
import { arbLineKind, arbSpeed, arbText, arbTickSchedule } from '../support/generators';

const arbBlock: fc.Arbitrary<TeletypeBlock> = fc.record(
  {
    kind: arbLineKind,
    text: arbText,
    cps: fc.oneof(fc.constant('instant' as const), fc.constantFrom(20, 30, 60, 300)),
    pauseAfterMs: fc.integer({ min: 0, max: 500 }),
  },
  { requiredKeys: ['kind', 'text'] },
);

interface Rig {
  tt: Teletype;
  term: FakeTerminal;
  revealed: BlockMeta[];
  idle: { count: number };
  total(): number;
}

function makeRig(getSpeed: () => Speed, motion: FakeMotion): Rig {
  const term = new FakeTerminal();
  const revealed: BlockMeta[] = [];
  const idle = { count: 0 };
  const tt = new Teletype({
    speed: getSpeed,
    reduced: () => motion.reduced(),
    sink: {
      begin: (b) => term.beginBlock(b),
      write: (id, c) => term.writeChunk(id, c),
      end: (b) => term.endBlock(b),
    },
    onRevealed: (b) => revealed.push(b),
    onIdle: () => {
      idle.count++;
    },
  });
  return {
    tt,
    term,
    revealed,
    idle,
    total: () => term.chunks.reduce((n, c) => n + Array.from(c.chunk).length, 0),
  };
}

describe('Property 6: Teletype reveals exactly the output text', () => {
  it('chunks concatenate to the block texts, in order, never regress, and flush reveals all', () => {
    fc.assert(
      fc.property(
        fc.array(arbBlock, { maxLength: 8 }),
        arbSpeed,
        fc.boolean(),
        arbTickSchedule,
        (blocks, speed, reduced, schedule) => {
          const stored = speed;
          const rig = makeRig(() => stored, new FakeMotion(reduced));
          const allText = blocks.map((b) => b.text).join('');
          const allLen = Array.from(allText).length;

          let prev = 0;
          const check = () => {
            const n = rig.total();
            expect(n).toBeGreaterThanOrEqual(prev);
            expect(n).toBeLessThanOrEqual(allLen);
            // revealed prefix is always a prefix of the full text
            expect(allText.startsWith(rig.term.chunks.map((c) => c.chunk).join(''))).toBe(true);
            prev = n;
          };

          for (const b of blocks) {
            rig.tt.enqueue(b, 0);
            check();
          }
          for (const step of schedule) {
            rig.tt.tick(step.at);
            check();
            if (step.flush) {
              rig.tt.flush();
              check();
              expect(rig.total()).toBe(allLen);
              expect(rig.tt.busy).toBe(false);
            }
          }
          rig.tt.flush();
          check();

          expect(rig.term.chunks.map((c) => c.chunk).join('')).toBe(allText);
          expect(rig.total()).toBe(allLen);
          expect(rig.tt.busy).toBe(false);

          // each block ended exactly once, in enqueue order
          const ends = rig.term.callsOf('endBlock').map((c) => c.block.id);
          expect(ends).toHaveLength(blocks.length);
          expect(new Set(ends).size).toBe(ends.length);
          expect([...ends].sort((a, b) => a - b)).toEqual(ends);
          expect(rig.revealed.map((b) => b.text)).toEqual(blocks.map((b) => b.text));
          rig.term.blocks.forEach((b, i) => {
            expect(b.ended).toBe(true);
            expect(b.revealed).toBe(blocks[i]!.text);
          });
          // speed setting untouched
          expect(stored).toBe(speed);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reveals everything before enqueue returns when speed is instant or motion is reduced', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ kind: arbLineKind, text: arbText }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.constantFrom('speed', 'reduced', 'both'),
        arbSpeed,
        (blocks, mode, otherSpeed) => {
          const speed: Speed = mode === 'reduced' ? otherSpeed : 'instant';
          const reduced = mode !== 'speed';
          const rig = makeRig(() => speed, new FakeMotion(reduced));
          let expected = '';
          blocks.forEach((b, i) => {
            rig.tt.enqueue(b, 1000 * i);
            expected += b.text;
            expect(rig.term.chunks.map((c) => c.chunk).join('')).toBe(expected);
            expect(rig.revealed).toHaveLength(i + 1);
            expect(rig.tt.busy).toBe(false);
          });
          expect(speed).toBe(mode === 'reduced' ? otherSpeed : 'instant');
        },
      ),
      { numRuns: 100 },
    );
  });
});
