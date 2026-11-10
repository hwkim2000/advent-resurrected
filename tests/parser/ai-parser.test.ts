import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiParser } from '../../src/parser/ai-parser';
import { CommandMemory } from '../../src/parser/game-context';
import type { AiParserDeps } from '../../src/parser/ai-parser';
import type { InputResolver, ResolveContext } from '../../src/ui/input-resolver';
import { FakeFetch } from '../support/ai-client-fakes';
import type { FetchBehavior } from '../support/ai-client-fakes';
import { newGame, cloneState } from '../../src/engine';
import { carry } from '../../src/engine/objects';
import { validateCommand } from '../../src/shared/command-validation';

// Task 8.4: AiParser must be assignable to InputResolver (src/ui never imports src/parser).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const assignable = (p: AiParser): InputResolver => p;

function makeState(): ResolveContext['state'] {
  const state = cloneState(newGame(1));
  state.session.pending = { k: 'command' } as typeof state.session.pending;
  return state;
}

describe('AiParser', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(script: FetchBehavior[], online = true) {
    const fake = new FakeFetch(script);
    const errors: unknown[] = [];
    const deps: AiParserDeps = {
      fetch: (i, init) => fake.fetch(i, init),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isOnline: () => online,
      log: { error: (m) => errors.push(m) },
    };
    const parser = new AiParser(deps);
    const ctx: ResolveContext = {
      gameMode: 'haunted',
      promptKind: 'command',
      phase: 'ready',
      state: makeState(),
    };
    return { fake, parser, ctx };
  }

  it('translates a valid answer and sends the hardened request', async () => {
    const { fake, parser, ctx } = setup([
      { kind: 'respond', status: 200, body: '{"command":"enter building"}' },
    ]);
    const out = await parser.translate("I'll go inside please", ctx, new AbortController().signal);
    expect(out).toEqual({ kind: 'translated', command: 'ENTER BUILD' });
    const init = fake.calls[0]!.init!;
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
  });

  describe('GHOST sentinel', () => {
    it.each(['GHOST', 'ghost', ' Ghost '])('maps a decoded %j answer to translated GHOST', async (answer) => {
      const { parser, ctx } = setup([{ kind: 'respond', status: 200, body: JSON.stringify({ command: answer }) }]);
      const out = await parser.translate('I am hopelessly confused', ctx, new AbortController().signal);
      expect(out).toEqual({ kind: 'translated', command: 'GHOST' });
    });

    it('rejects other invalid outputs and keeps the sentinel strict', async () => {
      for (const command of ['GHOSTS', 'GHOST LAMP', 'NOCOMMAND', 'QUIT', '']) {
        const { parser, ctx } = setup([{ kind: 'respond', status: 200, body: JSON.stringify({ command }) }]);
        const out = await parser.translate('I am hopelessly confused', ctx, new AbortController().signal);
        expect(out).toEqual({ kind: 'fallback', notice: true });
      }
    });

    it('lets ghost lines and phrases through with no request', async () => {
      const { fake, parser, ctx } = setup([{ kind: 'respond', status: 200, body: '{"command":"GHOST"}' }]);
      const s = new AbortController().signal;
      for (const line of ['ghost help', 'Ghost, where do I go?', "I'm stuck", 'what now']) {
        expect(parser.needsTranslation(line, ctx)).toBe(false);
        expect(await parser.translate(line, ctx, s)).toEqual({ kind: 'fallback', notice: false });
      }
      expect(fake.calls).toHaveLength(0);
      expect(parser.needsTranslation('please wander about', ctx)).toBe(true);
    });

    it('CommandMemory ignores GHOST (not a valid command)', () => {
      const m = new CommandMemory();
      m.note('GHOST');
      expect(m.last).toEqual([]);
    });
  });

  it('times out at the budget, prints one notice, and opens the circuit after three failures', async () => {
    const { fake, parser, ctx } = setup([{ kind: 'hang' }]);
    const outcomes = [];
    for (let i = 0; i < 3; i++) {
      const p = parser.translate('please wander about', ctx, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(4000);
      outcomes.push(await p);
    }
    expect(outcomes).toEqual([
      { kind: 'fallback', notice: true },
      { kind: 'fallback', notice: false },
      { kind: 'fallback', notice: false },
    ]);
    expect(fake.calls).toHaveLength(3);
    const blocked = await parser.translate('please wander about', ctx, new AbortController().signal);
    expect(blocked).toEqual({ kind: 'fallback', notice: false });
    expect(fake.calls).toHaveLength(3);
  });

  it('honors Retry-After after a 429 and does not notice 422 no_command', async () => {
    const { fake, parser, ctx } = setup([
      { kind: 'respond', status: 422, body: '{"error":"no_command"}' },
      { kind: 'respond', status: 429, body: '{"error":"rate_limited"}', headers: { 'retry-after': '500' } },
    ]);
    const s = new AbortController().signal;
    expect(await parser.translate('tell me a joke', ctx, s)).toEqual({ kind: 'fallback', notice: false });
    expect(await parser.translate('tell me a joke', ctx, s)).toEqual({ kind: 'fallback', notice: true });
    await parser.translate('tell me a joke', ctx, s);
    expect(fake.calls).toHaveLength(2);
    vi.advanceTimersByTime(119_000);
    await parser.translate('tell me a joke', ctx, s);
    expect(fake.calls).toHaveLength(2);
    vi.advanceTimersByTime(2_000);
    await parser.translate('tell me a joke', ctx, s);
    expect(fake.calls).toHaveLength(3);
  });

  it('falls back on a bad body, offline, and caller abort without throwing', async () => {
    const bad = setup([{ kind: 'respond', status: 200, body: '{"command":"QUIT"}' }]);
    const s = new AbortController().signal;
    expect(await bad.parser.translate('end it all', bad.ctx, s)).toEqual({ kind: 'fallback', notice: true });
    const off = setup([], false);
    expect(await off.parser.translate('end it all', off.ctx, s)).toEqual({ kind: 'fallback', notice: true });
    expect(off.fake.calls).toHaveLength(0);
    const hang = setup([{ kind: 'hang' }]);
    const ac = new AbortController();
    const p = hang.parser.translate('end it all', hang.ctx, ac.signal);
    ac.abort();
    expect(await p).toEqual({ kind: 'fallback', notice: false });
  });

  describe('object disambiguation', () => {
    const LAMP = 2;
    async function ask(loc: number, text: string, model: string, carried = false) {
      const { parser, ctx } = setup([{ kind: 'respond', status: 200, body: JSON.stringify({ command: model }) }]);
      if (carried) carry(ctx.state!.game, LAMP, 3);
      ctx.state!.game.loc = loc;
      return parser.translate(text, ctx, new AbortController().signal);
    }

    it('corrects "grab the lab" to TAKE LAMP when the lamp is visible', async () => {
      expect(await ask(3, 'grab the lab', 'TAKE FOOD')).toEqual({ kind: 'translated', command: 'TAKE LAMP' });
    });

    it('corrects to a carried lamp', async () => {
      expect(await ask(1, 'drop the lab', 'DROP FOOD', true)).toEqual({ kind: 'translated', command: 'DROP LAMP' });
    });

    it('is unchanged when the lamp is absent', async () => {
      expect(await ask(1, 'grab the lab', 'TAKE FOOD')).toEqual({ kind: 'translated', command: 'TAKE FOOD' });
    });

    it('is unchanged when the text supports the model object', async () => {
      expect(await ask(3, 'please take the keys', 'TAKE KEYS')).toEqual({ kind: 'translated', command: 'TAKE KEYS' });
    });

    it('always yields a valid command', async () => {
      const out = await ask(3, 'grab the lab', 'TAKE FOOD');
      expect(out.kind === 'translated' && validateCommand(out.command).ok).toBe(true);
    });
  });
});
