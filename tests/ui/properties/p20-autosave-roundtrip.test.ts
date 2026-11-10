// Feature: voice-input, Property 20: The autosave round-trips the Deflection_Count and every other field
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newGame, serialize, start, step } from '../../../src/engine/index';
import type { Env, GameState } from '../../../src/engine/index';
import {
  AUTOSAVE_LINE_KINDS,
  AUTOSAVE_MAX_LINES,
  DEFLECTION_LIMIT,
  decodeAutosave,
  encodeAutosave,
} from '../../../src/ui/autosave';
import type { PromptInfo, TranscriptLine } from '../../../src/ui/types';
import { voiceAssert } from '../../voice/support/pbt';
import { arbCommandSequence } from '../support/generators';

const env: Env = { storage: { read: () => undefined, write: () => true } };

// Strings with lone surrogates, quotes, newlines and non-ASCII.
const loneUnit = fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c));
const arbStr = fc.string({
  unit: fc.oneof(loneUnit, fc.constantFrom('a', ' ', '"', '\\', '\n', 'é', '\u{1F600}')),
  maxLength: 30,
});

const arbLine: fc.Arbitrary<TranscriptLine> = fc.record({
  kind: fc.constantFrom(...AUTOSAVE_LINE_KINDS),
  text: arbStr,
  eol: fc.boolean(),
});

const arbPrompt: fc.Arbitrary<PromptInfo> = fc.record({
  kind: fc.constantFrom('command' as const, 'yesno' as const, 'filename' as const),
  text: arbStr,
});

const arbDeflections = fc.integer({ min: 0, max: DEFLECTION_LIMIT });

/** Play seeded commands; the result is a running state or undefined. */
function reach(seed: number, commands: readonly string[]): GameState | undefined {
  let cur = start(newGame(seed), env).state;
  for (const c of commands) {
    if (cur.session.status !== 'running') break;
    cur = step(cur, c, env).state;
  }
  return cur.session.status === 'running' ? cur : undefined;
}

describe('Property 20: autosave round trip with the Deflection_Count', () => {
  /** **Validates: Requirements 13.11, 13.12, 13.15** */
  it('decode(encode(x)) returns the same count, state, prompt and lines', () => {
    voiceAssert(
      fc.property(
        fc.integer({ min: -2147483648, max: 2147483647 }),
        arbCommandSequence,
        arbPrompt,
        fc.array(arbLine, { maxLength: 40 }),
        arbDeflections,
        (seed, commands, prompt, lines, deflections) => {
          const state = reach(seed, commands);
          fc.pre(state !== undefined);
          const json = encodeAutosave(state!, prompt, lines, undefined, deflections);
          expect(json).toBeDefined();
          const back = decodeAutosave(json!);
          expect(back).toBeDefined();
          expect(back!.deflections).toBe(deflections);
          expect(serialize(back!.state)).toBe(serialize(state!));
          expect(back!.prompt).toEqual(prompt);
          expect(back!.lines).toEqual(lines.slice(-AUTOSAVE_MAX_LINES));
        },
      ),
    );
  });

  /** **Validates: Requirements 13.11** */
  it('count 0 is byte-identical to the pre-feature encoding and has no ui key', () => {
    voiceAssert(
      fc.property(arbPrompt, fc.array(arbLine, { maxLength: 40 }), (prompt, lines) => {
        const state = start(newGame(3), env).state;
        const legacy = JSON.stringify({
          v: 1,
          state: serialize(state),
          prompt: { kind: prompt.kind, text: prompt.text },
          lines: lines.map((l) => ({ kind: l.kind, text: l.text, eol: l.eol })),
        });
        const json = encodeAutosave(state, prompt, lines, undefined, 0);
        expect(json).toBe(legacy);
        expect(encodeAutosave(state, prompt, lines)).toBe(legacy);
        expect('ui' in JSON.parse(json!)).toBe(false);
      }),
    );
  });

  /** **Validates: Requirements 13.12, 13.15** */
  it('an autosave written after a step that follows a Deflection still carries the count', () => {
    voiceAssert(
      fc.property(
        fc.integer({ min: -2147483648, max: 2147483647 }),
        arbCommandSequence,
        arbCommandSequence,
        arbDeflections,
        (seed, before, after, deflections) => {
          const mid = reach(seed, before);
          fc.pre(mid !== undefined);
          // The Deflection runs no step; the count is then passed to every later write.
          const next = reach(seed, [...before, ...after]);
          fc.pre(next !== undefined);
          const prompt: PromptInfo = { kind: 'command', text: '' };
          const json = encodeAutosave(next!, prompt, [], undefined, deflections);
          const back = decodeAutosave(json!);
          expect(back).toBeDefined();
          expect(back!.deflections).toBe(deflections);
          expect(serialize(back!.state)).toBe(serialize(next!));
        },
      ),
    );
  });
});
