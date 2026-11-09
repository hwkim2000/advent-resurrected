// Feature: ai-parser, Property 5: Eligibility partition
// **Validates: Requirements 1.1, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 11.1, 13.4, 13.5, 13.6**
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AiParser } from '../../../src/parser/ai-parser';
import type { ResolveInput } from '../../../src/parser/eligibility';
import { cloneState, newGame } from '../../../src/engine';
import type { GameState } from '../../../src/engine';
import { NO_WORD_TYPE, getVocabMetadata } from '../../../src/engine/classic-parser';
import { normalizePlayerText } from '../../../src/shared/normalize';
import { TEXT_MAX_CHARS } from '../../../src/shared/limits';
import { ACTIONS, MOTIONS, OBJECTS } from '../../../src/data/dungeon';
import { FakeFetch } from '../../support/ai-client-fakes';
import { arbAdversarialText } from '../../support/ai-generators';

const RUNS = { numRuns: 150 };

function stateWith(pending: GameState['session']['pending']): GameState {
  const s = cloneState(newGame(1));
  s.session.pending = pending;
  return s;
}
const COMMAND_STATE = stateWith({ k: 'command' });
const OTHER_PENDING_STATES = [stateWith({ k: 'quit' }), stateWith({ k: 'hint-question', hint: 4 })];

// The stock reservoir word (z'zzz, action PART) is a table entry but, as in the C
// get_vocab_metadata, not a vocabulary word; the engine's own lookup decides.
const VOCAB_WORDS: string[] = [...MOTIONS, ...OBJECTS, ...ACTIONS]
  .flatMap((e) => [...e.words])
  .filter((w) => getVocabMetadata(w, COMMAND_STATE.game.zzword, false).type !== NO_WORD_TYPE);

type Mode = ResolveInput['gameMode'];
type Prompt = ResolveInput['promptKind'];
type Phase = ResolveInput['phase'];

function makeParser() {
  const fake = new FakeFetch([{ kind: 'respond', status: 200, body: '{"command":"LOOK"}' }]);
  const parser = new AiParser({
    fetch: (i, init) => fake.fetch(i, init),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isOnline: () => true,
    log: { error: () => {} },
  });
  return { fake, parser };
}

const arbMode: fc.Arbitrary<Mode> = fc.constantFrom('haunted', '1976', undefined);
const arbPrompt: fc.Arbitrary<Prompt> = fc.constantFrom('command', 'yesno', 'filename', undefined);
const arbPhase: fc.Arbitrary<Phase> = fc.constantFrom('booting', 'ready', 'over', 'failed', undefined);
const arbState: fc.Arbitrary<GameState | undefined> = fc.constantFrom(
  COMMAND_STATE,
  ...OTHER_PENDING_STATES,
  undefined,
);

/** Sentences of 3 to 6 lowercase words: never a classic command (more than two words). */
const arbSentence: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 3, maxLength: 6 }),
    fc.constantFrom('', ' ', '  '),
    fc.constantFrom('', ' ', '\t'),
  )
  .map(([words, lead, trail]) => `${lead}${words.join(' ')}${trail}`);

const arbMixedCase = (w: string): fc.Arbitrary<string> =>
  fc.array(fc.boolean(), { minLength: w.length, maxLength: w.length }).map((flags) =>
    [...w].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(''),
  );

const arbClassicCommand: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...VOCAB_WORDS), fc.option(fc.constantFrom(...VOCAB_WORDS), { nil: undefined }))
  .chain(([a, b]) =>
    fc.tuple(arbMixedCase(a), b === undefined ? fc.constant(undefined) : arbMixedCase(b)),
  )
  .map(([a, b]) => (b === undefined ? a : `${a} ${b}`));

const arbLine: fc.Arbitrary<string> = fc.oneof(
  arbAdversarialText,
  arbSentence,
  arbClassicCommand,
  fc.string({ maxLength: 40 }),
  fc.integer({ min: -50, max: 99999 }).map(String),
  fc.constantFrom('', ' ', '  \t '),
);

function input(mode: Mode, prompt: Prompt, phase: Phase, state: GameState | undefined): ResolveInput {
  return { gameMode: mode, promptKind: prompt, phase, state };
}

async function run(line: string, ri: ResolveInput) {
  const { fake, parser } = makeParser();
  const outcome = await parser.translate(line, ri, new AbortController().signal);
  return { fake, outcome };
}

describe('Property 5: Eligibility partition', () => {
  it('sends at most one request, only when eligible, and gives the original line on otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(arbLine, arbMode, arbPrompt, arbPhase, arbState, async (line, mode, prompt, phase, state) => {
        const { fake, outcome } = await run(line, input(mode, prompt, phase, state));
        expect(fake.callCount).toBeLessThanOrEqual(1);

        const structurallyEligible =
          mode === 'haunted' && prompt === 'command' && phase === 'ready' && state === COMMAND_STATE;
        if (!structurallyEligible) {
          // Zero requests; the caller keeps the original line (fallback, no translation).
          expect(fake.callCount).toBe(0);
          expect(outcome).toEqual({ kind: 'fallback', notice: false });
          return;
        }
        if (fake.callCount === 0) {
          expect(outcome.kind).toBe('fallback');
          return;
        }
        // The single eligible request.
        const call = fake.calls[0]!;
        expect(call.url).toBe('/api/parse');
        const body = call.json as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(['context', 'text']);
        expect(body.text).toBe(normalizePlayerText(line));
        expect((body.text as string).length).toBeGreaterThan(0);
        expect((body.text as string).length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
        expect(outcome).toEqual({ kind: 'translated', command: 'LOOK' });
      }),
      RUNS,
    );
  });

  it('sends exactly one request for an eligible sentence, with text equal to the normalized line', async () => {
    await fc.assert(
      fc.asyncProperty(arbSentence, async (line) => {
        const { fake, outcome } = await run(line, input('haunted', 'command', 'ready', COMMAND_STATE));
        expect(fake.callCount).toBe(1);
        const body = fake.calls[0]!.json as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(['context', 'text']);
        expect(body.text).toBe(normalizePlayerText(line));
        expect(outcome.kind).toBe('translated');
      }),
      RUNS,
    );
  });

  it('makes zero requests in 1976 mode for arbitrary lines', async () => {
    await fc.assert(
      fc.asyncProperty(arbLine, arbPrompt, arbPhase, async (line, prompt, phase) => {
        const { fake, outcome } = await run(line, input('1976', prompt, phase, COMMAND_STATE));
        expect(fake.callCount).toBe(0);
        expect(outcome).toEqual({ kind: 'fallback', notice: false });
      }),
      RUNS,
    );
  });

  it('makes zero requests for yesno and filename prompts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(arbLine, arbSentence),
        fc.constantFrom<Prompt>('yesno', 'filename'),
        async (line, prompt) => {
          const { fake, outcome } = await run(line, input('haunted', prompt, 'ready', COMMAND_STATE));
          expect(fake.callCount).toBe(0);
          expect(outcome).toEqual({ kind: 'fallback', notice: false });
        },
      ),
      RUNS,
    );
  });

  it('makes zero requests for classic commands, numbers, blanks, and over-long or unsafe text', async () => {
    const ri = input('haunted', 'command', 'ready', COMMAND_STATE);
    await fc.assert(
      fc.asyncProperty(arbClassicCommand, async (line) => {
        const { fake, parser } = makeParser();
        expect(parser.needsTranslation(line, ri)).toBe(false);
        const outcome = await parser.translate(line, ri, new AbortController().signal);
        expect(fake.callCount).toBe(0);
        expect(outcome.kind).toBe('fallback');
      }),
      RUNS,
    );
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer({ min: -9999, max: 99999 }).map(String),
          fc.constantFrom('', ' ', ' \t '),
          fc.array(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 40, maxLength: 60 }).map((w) => w.join(' ')),
          arbSentence.map((s) => `${s} \u0000x`),
          arbSentence.map((s) => `${s} \ud800`),
        ),
        async (line) => {
          const { fake, outcome } = await run(line, ri);
          expect(fake.callCount).toBe(0);
          expect(outcome).toEqual({ kind: 'fallback', notice: false });
        },
      ),
      RUNS,
    );
  });
});
