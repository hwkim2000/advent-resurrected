import { describe, expect, it } from 'vitest';
import { FEE, FIE, FOE, FOO, REQUIRES_DYNAMITE } from '../data/constants';
import { ARBITRARY_MESSAGES } from '../data/dungeon';
import {
  BLOCKED,
  GO_CLEAROBJ,
  bigwords,
  blast,
  quit,
  resume,
  resumeQuit,
  suspend,
  resumeSuspendConfirm,
} from './actions-special';
import { newGame } from './init';
import type { IoCtx } from './io';

function setup() {
  const state = newGame(0);
  const ctx: IoCtx = { game: state.game, events: [] };
  return { state, ctx, session: state.session };
}

describe('actions-special', () => {
  it('advances the magic-word sequence and emits magic-word-used', () => {
    const { ctx, session } = setup();
    expect(bigwords(ctx, session, FEE)).toBe(GO_CLEAROBJ);
    expect(ctx.game.foobar).toBe(FEE);
    bigwords(ctx, session, FIE);
    bigwords(ctx, session, FOE);
    expect(ctx.game.foobar).toBe(FOE);
    bigwords(ctx, session, FOO);
    expect(ctx.game.foobar).toBe(0);
    const words = ctx.events.filter((e) => e.type === 'magic-word-used');
    expect(words.map((e) => (e as { word: string }).word)).toEqual(['FEE', 'FIE', 'FOE', 'FOO']);
  });

  it('blast without dynamite just says so', () => {
    const { ctx, session } = setup();
    blast(ctx, session);
    expect(session.status).toBe('running');
    const t = ctx.events.find((e) => e.type === 'text') as { text: string };
    expect(t.text).toBe(ARBITRARY_MESSAGES[REQUIRES_DYNAMITE]);
  });

  it('quit blocks, re-asks on junk, ends the game on yes', () => {
    const { ctx, session } = setup();
    expect(quit(ctx, session)).toBe(BLOCKED);
    expect(session.pending).toEqual({ k: 'quit' });
    expect(resumeQuit(ctx, session, 'maybe')).toBe(BLOCKED);
    expect(session.status).toBe('running');
    expect(resumeQuit(ctx, session, 'yes')).toBe(GO_CLEAROBJ);
    expect(session.status).toBe('over');
    expect(session.exitReason).toBe('quit');
  });

  it('suspend charges the penalty only after confirmation', () => {
    const { ctx, session } = setup();
    expect(suspend(ctx, session)).toBe(BLOCKED);
    expect(ctx.game.saved).toBe(0);
    expect(resumeSuspendConfirm(ctx, session, 'y')).toBe(BLOCKED);
    expect(ctx.game.saved).toBe(5);
    expect(session.pending).toEqual({ k: 'suspend-file' });
  });

  it('resume at the start goes straight to the file-name read', () => {
    const { ctx, session } = setup();
    ctx.game.locs[ctx.game.loc]!.abbrev = 1;
    expect(resume(ctx, session)).toBe(BLOCKED);
    expect(session.pending).toEqual({ k: 'resume-file' });
  });
});
