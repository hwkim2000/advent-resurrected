import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiParser } from '../../src/parser/ai-parser';
import type { AiParserDeps } from '../../src/parser/ai-parser';
import type { InputResolver, ResolveContext } from '../../src/ui/input-resolver';
import { FakeFetch } from '../support/ai-client-fakes';
import type { FetchBehavior } from '../support/ai-client-fakes';
import { newGame, cloneState } from '../../src/engine';

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
});
