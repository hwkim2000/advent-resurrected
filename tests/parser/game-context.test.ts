import { describe, expect, it } from 'vitest';
import { newGame, cloneState } from '../../src/engine';
import { carry } from '../../src/engine/objects';
import { LAMP } from '../../src/data/constants';
import { CommandMemory, buildGameContext } from '../../src/parser/game-context';

describe('buildGameContext', () => {
  it('describes the start location without mutating the state', () => {
    const state = newGame(1);
    const before = JSON.stringify(state);
    const ctx = buildGameContext(state, []);
    expect(JSON.stringify(state)).toBe(before);
    expect(ctx.room).not.toBe('pitch dark');
    expect(ctx.objects).toEqual([]);
    expect(ctx.last).toEqual([]);
  });

  it('lists a visible object and hides it when carried', () => {
    const state = cloneState(newGame(1));
    const game = state.game;
    game.loc = 3; // building
    expect(buildGameContext(state, []).objects).toContain('LAMP');
    carry(game, LAMP, game.loc);
    expect(buildGameContext(state, []).objects).not.toContain('LAMP');
  });
});

describe('CommandMemory', () => {
  it('keeps the last two canonical commands and rejects others', () => {
    const m = new CommandMemory();
    m.note('enter building');
    m.note('42');
    m.note('quit');
    m.note('blorp');
    m.note('take lamp');
    expect(m.last).toEqual(['ENTER BUILD', 'TAKE LAMP']);
    m.note('west');
    expect(m.last).toEqual(['TAKE LAMP', 'WEST']);
    m.reset();
    expect(m.last).toEqual([]);
  });
});
