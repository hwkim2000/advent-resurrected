// Feature: voice-input, Property 18: The Spoken_Word_Rule deflects exactly when its conditions hold
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFLECTION_LIMIT,
  DEFLECTION_LINE,
  createSpokenWordGate,
} from '../../../src/haunt/spoken-word-rule';
import { loadAutosave } from '../../../src/ui/autosave';
import { ExtensionHooks } from '../../../src/ui/extension-hooks';
import type { HookContext } from '../../../src/ui/extension-hooks';
import type { InputOrigin, Mode, PromptKind } from '../../../src/ui/types';
import { RecordingLogger, ScriptedResolver, makeController } from '../../ui/support/fakes';
import { voiceAssert } from '../../voice/support/pbt';

/* ---- independent oracle ------------------------------------------------- */

/**
 * The engine reads at most two whitespace-separated words and compares the
 * first five characters, case-insensitively. Written here from the requirement
 * text, not from the implementation.
 */
function oracleHasXyzzy(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w !== '').slice(0, 2);
  return words.some((w) => w.slice(0, 5).toLowerCase() === 'xyzzy');
}

interface Conditions {
  mode: Mode;
  prompt: PromptKind;
  usable: boolean;
  origin: InputOrigin;
  text: string;
  count: number;
}

function oracleDeflects(c: Conditions): boolean {
  return (
    c.mode === 'haunted' &&
    c.prompt === 'command' &&
    c.usable &&
    c.origin === 'typed' &&
    oracleHasXyzzy(c.text) &&
    c.count < 1
  );
}

/* ---- generators --------------------------------------------------------- */

const POOL = [
  'xyzzy',
  'XYZZY',
  'Xyzzy',
  'xyzzyx',
  'xyzz',
  'plugh',
  'PLUGH',
  'plover',
  'fee',
  'fie',
  'foe',
  'foo',
  'go',
  'say',
  'look',
  'inventory',
  'take',
  'lamp',
  'zizzy',
];

const arbText = fc
  .array(
    fc.record({
      sep: fc.constantFrom(' ', '  ', '\t', ' \t '),
      word: fc.constantFrom(...POOL),
    }),
    { maxLength: 4 },
  )
  .chain((parts) =>
    fc.constantFrom('', ' ').map((lead) => lead + parts.map((p, i) => (i === 0 ? '' : p.sep) + p.word).join('')),
  );

const arbMode = fc.constantFrom<Mode>('haunted', '1976');
const arbPrompt = fc.constantFrom<PromptKind>('command', 'yesno', 'filename');
const arbOrigin = fc.constantFrom<InputOrigin>('typed', 'spoken');

function ctxOf(mode: Mode, selected: Mode, prompt: PromptKind): HookContext {
  return { gameMode: mode, selectedMode: selected, prompt };
}

describe('Property 18: the Spoken_Word_Rule deflects exactly when its conditions hold', () => {
  it('the registered gate deflects iff every condition holds (pure decision)', () => {
    voiceAssert(
      fc.property(
        arbMode,
        arbMode,
        arbPrompt,
        fc.boolean(),
        arbOrigin,
        arbText,
        fc.integer({ min: 0, max: 3 }),
        (mode, selected, prompt, usable, origin, text, count) => {
          const hooks = new ExtensionHooks(new RecordingLogger());
          hooks.addInputGate(createSpokenWordGate({ isVoiceUsable: () => usable }));
          const got = hooks.gateInput(text, origin, count, ctxOf(mode, selected, prompt));
          const want = oracleDeflects({ mode, prompt, usable, origin, text, count });
          expect(got.kind === 'deflect').toBe(want);
          if (got.kind === 'deflect') expect(got.lines).toEqual([DEFLECTION_LINE]);
        },
      ),
    );
  });

  it('the pool contains XYZZY motion words and non-words as expected', () => {
    expect(oracleHasXyzzy('go xyzzy')).toBe(true);
    expect(oracleHasXyzzy('xyzzyx')).toBe(true);
    expect(oracleHasXyzzy('look at xyzzy')).toBe(false);
    expect(oracleHasXyzzy('plugh')).toBe(false);
  });

  /* ---- real controller ---- */

  type Op =
    | { kind: 'submit'; origin: InputOrigin; text: string }
    | { kind: 'usable'; value: boolean };

  const arbOp: fc.Arbitrary<Op> = fc.oneof(
    { arbitrary: fc.record({ kind: fc.constant('submit' as const), origin: arbOrigin, text: arbText }), weight: 4 },
    { arbitrary: fc.record({ kind: fc.constant('usable' as const), value: fc.boolean() }), weight: 1 },
  );

  it('a real GameController deflects exactly per the oracle and the count never exceeds the limit', () => {
    voiceAssert(
      fc.property(
        arbMode,
        fc.boolean(),
        fc.integer({ min: 0, max: 1 }),
        fc.array(arbOp, { maxLength: 12 }),
        (mode, initiallyUsable, startCount, ops) => {
          let usable = initiallyUsable;
          const made = makeController({
            mode,
            deflections: startCount,
            gates: [createSpokenWordGate({ isVoiceUsable: () => usable })],
          });
          const { controller, view, kv } = made;
          let count = startCount;
          if (controller.promptKind === 'yesno') controller.submit('no', 'typed');
          for (const op of ops) {
            if (op.kind === 'usable') {
              usable = op.value;
              continue;
            }
            if (controller.phase !== 'ready' || controller.promptKind === undefined) break;
            const prompt = controller.promptKind;
            const want = oracleDeflects({
              mode,
              prompt,
              usable,
              origin: op.origin,
              text: op.text,
              count,
            });
            const narratorBefore = view.blocks.filter((b) => b.kind === 'narrator').length;
            const stateBefore = controller.engineState;
            controller.submit(op.text, op.origin);
            const deflectedLines = view.blocks
              .filter((b) => b.kind === 'narrator')
              .slice(narratorBefore)
              .filter((b) => b.text === DEFLECTION_LINE + '\n');
            expect(deflectedLines.length).toBe(want ? 1 : 0);
            // A deflection never reaches `step`; the state object is untouched.
            if (want) expect(controller.engineState).toBe(stateBefore);
            else expect(controller.engineState).not.toBe(stateBefore);
            if (want) count += 1;
            expect(count).toBeLessThanOrEqual(DEFLECTION_LIMIT);
            const stored = loadAutosave(kv)?.deflections ?? 0;
            expect(stored).toBe(count);
          }
        },
      ),
    );
  });

  it('with several typed XYZZY lines queued at count 0, exactly the first is deflected', async () => {
    await voiceAssert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), arbOrigin, async (n, otherOrigin) => {
        const resolver = new ScriptedResolver();
        let release: (() => void) | undefined;
        resolver.needs = (line) => line === 'look';
        resolver.outcome = (line) =>
          new Promise((resolve) => {
            release = () => resolve({ kind: 'translated', command: line });
          });
        const made = makeController({
          resolver,
          gates: [createSpokenWordGate({ isVoiceUsable: () => true })],
        });
        const { controller, view } = made;
        if (controller.promptKind === 'yesno') controller.submit('no', 'typed');
        controller.submit('look', otherOrigin); // holds the queue while it "translates"
        const stateBefore = controller.engineState;
        for (let i = 0; i < n; i += 1) controller.submit('xyzzy', 'typed');
        // Everything after the held line is queued, nothing has reached the engine.
        expect(controller.engineState).toBe(stateBefore);
        release?.();
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
        const deflected = view.blocks.filter(
          (b) => b.kind === 'narrator' && b.text === DEFLECTION_LINE + '\n',
        );
        expect(deflected.length).toBe(1);
        expect(loadAutosave(made.kv)?.deflections).toBe(1);
      }),
    );
  });

  it('a spoken XYZZY is never deflected', () => {
    voiceAssert(
      fc.property(fc.constantFrom('xyzzy', 'XYZZY', 'go xyzzy', 'xyzzyx'), (text) => {
        const made = makeController({
          gates: [createSpokenWordGate({ isVoiceUsable: () => true })],
        });
        made.controller.submit(text, 'spoken');
        expect(made.view.blocks.some((b) => b.text === DEFLECTION_LINE + '\n')).toBe(false);
      }),
    );
  });
});
