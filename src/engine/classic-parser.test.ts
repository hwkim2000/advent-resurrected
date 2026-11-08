import { describe, expect, it } from 'vitest';
import { BIRD, ENTER, LAMP, NO_OBJECT, STREAM, TWO_WORDS } from '../data/constants';
import { ARBITRARY_MESSAGES } from '../data/dungeon';
import {
  ACTION,
  CMD_EMPTY,
  CMD_GIVEN,
  CMD_PREPROCESSED,
  MOTION,
  NUMERIC,
  OBJECT,
  clearCommand,
  getCommandInput,
  getVocabMetadata,
  preprocessCommand,
  wordCount,
} from './classic-parser';
import { newGame } from './init';
import type { IoCtx } from './io';
import type { CommandT } from './types';

function setup(oldstyle = false) {
  const state = newGame(0, { oldstyle });
  const ctx: IoCtx = { game: state.game, events: [] };
  const cmd: CommandT = state.session.cmd;
  return { state, ctx, cmd, settings: state.session.settings };
}

describe('classic parser', () => {
  it('counts words on space and tab only', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  go   west ')).toBe(2);
    expect(wordCount('a\tb c')).toBe(3);
  });

  it('matches only the first TOKLEN characters, ignoring case', () => {
    const z = 'XXXXX';
    expect(getVocabMetadata('ENTERING', z, false)).toEqual(getVocabMetadata('enter', z, false));
    expect(getVocabMetadata('lampx', z, false).id).toBe(-1);
    expect(getVocabMetadata('lamp', z, false)).toEqual({ id: LAMP, type: OBJECT });
    expect(getVocabMetadata('enter', z, false).type).toBe(MOTION);
    expect(getVocabMetadata('zzqq', z, false)).toEqual({ id: -1, type: 0 });
    expect(getVocabMetadata('-12', z, false).type).toBe(NUMERIC);
    expect(getVocabMetadata('', z, false)).toEqual({ id: 0, type: 0 });
  });

  it('recognizes the bird magic word case-insensitively', () => {
    const { ctx } = setup();
    const zz = ctx.game.zzword;
    expect(getVocabMetadata(zz.toLowerCase(), zz, false).type).toBe(ACTION);
  });

  it('rejects more than two words with TWO_WORDS and empty lines silently', () => {
    const { ctx, cmd, settings } = setup();
    expect(getCommandInput(ctx, settings, cmd, 'a b c')).toBe(false);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({
      type: 'text',
      template: ARBITRARY_MESSAGES[TWO_WORDS],
    });
    ctx.events.length = 0;
    expect(getCommandInput(ctx, settings, cmd, '')).toBe(false);
    expect(ctx.events).toHaveLength(0);
    // Whitespace-only is a real (null) command.
    expect(getCommandInput(ctx, settings, cmd, '  ')).toBe(true);
    expect(cmd.state).toBe(CMD_GIVEN);
  });

  it('oldstyle uppercases and truncates to 10 characters', () => {
    const { ctx, cmd, settings } = setup(true);
    getCommandInput(ctx, settings, cmd, 'abcdefghijklmnop lamp');
    expect(cmd.word[0].raw).toBe('ABCDEFGHIJ');
    expect(cmd.word[1].raw).toBe('LAMP');
  });

  it('clearCommand copies obj to oldobj and resets', () => {
    const { ctx, cmd } = setup();
    cmd.obj = 7;
    cmd.state = 6;
    clearCommand(ctx, cmd);
    expect(ctx.game.oldobj).toBe(7);
    expect(cmd.obj).toBe(NO_OBJECT);
    expect(cmd.state).toBe(CMD_EMPTY);
  });

  it('preprocess swaps object-verb order and defaults to motion', () => {
    const { ctx, cmd, settings } = setup();
    getCommandInput(ctx, settings, cmd, 'lamp get');
    expect(preprocessCommand(ctx, cmd)).toBe(true);
    expect(cmd.word[0].type).toBe(ACTION);
    expect(cmd.word[1].type).toBe(OBJECT);
    expect(cmd.state).toBe(CMD_PREPROCESSED);

    getCommandInput(ctx, settings, cmd, 'qqqq');
    preprocessCommand(ctx, cmd);
    expect(cmd.word[0].type).toBe(MOTION);
  });

  it('enter stream is handled with a message and not completed', () => {
    const { ctx, cmd, settings } = setup();
    getCommandInput(ctx, settings, cmd, 'enter stream');
    expect(cmd.word[0].id).toBe(ENTER);
    expect(cmd.word[1].id).toBe(STREAM);
    ctx.events.length = 0;
    expect(preprocessCommand(ctx, cmd)).toBe(false);
    expect(ctx.events).toHaveLength(1);
  });

  it('cage bird becomes carry only when both are here', () => {
    const { ctx, cmd, settings } = setup();
    getCommandInput(ctx, settings, cmd, 'cage bird');
    preprocessCommand(ctx, cmd);
    expect(cmd.word[0].type).toBe(OBJECT);
    expect(cmd.word[1].id).toBe(BIRD);
  });
});
