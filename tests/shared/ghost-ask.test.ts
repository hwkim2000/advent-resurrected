import { describe, expect, it } from 'vitest';
import { newGame } from '../../src/engine';
import { isClassicCommandText } from '../../src/shared/command-validation';
import {
  GHOST_PHRASES,
  GHOST_TOKEN,
  isGhostAsk,
  isGhostPhrase,
  isGhostPrefixAsk,
  isGhostToken,
} from '../../src/shared/ghost-ask';
import { lookupWord } from '../../src/shared/vocabulary';

describe('ghost-ask', () => {
  it.each([
    'ghost',
    'Ghost.',
    'GHOST help',
    'ghost help',
    'ghost, where do I go?',
    'Ghost! what now',
    'hey ghost, help',
    'Oh ghost',
    '  ghost   hint ',
  ])('prefix ask: %j', (t) => {
    expect(isGhostPrefixAsk(t)).toBe(true);
    expect(isGhostAsk(t)).toBe(true);
  });

  it.each(["I'm stuck", 'im stuck', 'I am stuck.', 'what now?', 'What do I do?!', 'where do i go', 'Help me', "I\u2019m stuck"])(
    'phrase ask: %j',
    (t) => {
      expect(isGhostPhrase(t)).toBe(true);
      expect(isGhostAsk(t)).toBe(true);
    },
  );

  it.each([
    'ghostly',
    'ghosts',
    "ghost's",
    'ghost-writer',
    'HELP',
    'INFO',
    'help',
    'take lamp',
    'enter building',
    'the ghost',
    'where do I go next',
    'I am not stuck',
    '',
  ])('not an ask: %j', (t) => {
    expect(isGhostAsk(t)).toBe(false);
  });

  it('recognizes the token itself, trimmed and case-insensitive', () => {
    for (const t of ['GHOST', ' ghost\n', 'Ghost']) expect(isGhostToken(t)).toBe(true);
    for (const t of ['GHOST LAMP', 'GHOSTS', '']) expect(isGhostToken(t)).toBe(false);
    expect(GHOST_TOKEN).toBe('GHOST');
  });

  it('ghost is not vocabulary and no phrase is a classic command', () => {
    expect(lookupWord('GHOST')).toBeUndefined();
    const g = newGame(1).game;
    for (const p of [...GHOST_PHRASES, 'ghost', 'ghost help']) {
      expect(isClassicCommandText(p, g.zzword, false)).toBe(false);
      expect(isClassicCommandText(p, g.zzword, true)).toBe(false);
    }
  });
});
