// Feature: ai-parser, Property 19: Autosave round trip with translation lines
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newGame, serialize, start } from '../../../src/engine/index';
import type { Env } from '../../../src/engine/index';
import { decodeAutosave, encodeAutosave } from '../../../src/ui/autosave';
import type { PromptInfo } from '../../../src/ui/types';
import { arbTranscriptLine } from '../../ui/support/generators';

const env: Env = { storage: { read: () => undefined, write: () => true } };

const arbPrompt: fc.Arbitrary<PromptInfo> = fc.record({
  kind: fc.constantFrom<PromptInfo['kind']>('command', 'yesno', 'filename'),
  text: fc.string({ maxLength: 20 }),
});

describe('Property 19: Autosave round trip with translation lines', () => {
  /** **Validates: Requirements 4.13, 4.14, 4.15, 13.13** */
  it('decode(encode(x)) returns the same state, prompt and the last 200 non-boot lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.boolean(),
        arbPrompt,
        fc.array(arbTranscriptLine, { maxLength: 260 }),
        (seed, oldstyle, prompt, lines) => {
          const { state } = start(newGame(seed, { oldstyle }), env);
          const json = encodeAutosave(state, prompt, lines);
          expect(json).toBeDefined();
          const restored = decodeAutosave(json!);
          expect(restored).toBeDefined();
          expect(serialize(restored!.state)).toBe(serialize(state));
          expect(restored!.prompt).toEqual(prompt);
          expect(restored!.lines).toEqual(lines.filter((l) => l.kind !== 'boot').slice(-200));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps translation lines in the persisted tail', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }).map((t) => t.replace(/[\r\n]/g, '')), (text) => {
        const { state } = start(newGame(1), env);
        const json = encodeAutosave(state, { kind: 'command', text: '' }, [
          { kind: 'translation', text, eol: true },
        ]);
        expect(decodeAutosave(json!)!.lines).toEqual([{ kind: 'translation', text, eol: true }]);
      }),
      { numRuns: 100 },
    );
  });
});
