import { describe, expect, it } from 'vitest';
import { newGame } from '../../src/engine';
import { isClassicCommandText } from '../../src/shared/command-validation';
import {
  GHOST_PHRASES,
  GHOST_TOKEN,
  isGhostAsk,
  isGhostHelpQuestion,
  isGhostOfflineAsk,
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
    'I am not stuck',
    'I am never lost',
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

describe('broad offline help matcher', () => {
  it.each([
    'I am stuck, what now?',
    "I'm totally lost, any hints?",
    'I have no idea what to do',
    'any advice for a beginner?',
    'where am I supposed to go from here',
    'nudge me in the right direction please',
    'can you give me a clue',
    'what should I do next',
    'where should I go?',
    'where do I go next',
    'I dont know what to do',
    "I don't know where to go",
    'I need some help',
    'can you help',
    'give me a hint',
    'hint',
    'clues?',
    'what am I supposed to do',
    'how do I proceed',
    'I give up',
    'Im so confused',
  ])('help question: %j', (t) => {
    expect(isGhostHelpQuestion(t)).toBe(true);
    expect(isGhostOfflineAsk(t)).toBe(true);
    expect(isGhostAsk(t)).toBe(true);
  });

  it.each([
    'HELP',
    'help',
    'INFO',
    'info',
    'take lamp',
    'TAKE KEYS',
    'go west',
    'enter building',
    'light the lamp',
    'switch off the lamp',
    'I lost my keys',
    'how is the weather today',
    'tell me a joke about computers',
    'what is your favorite color',
    'where is the lamp',
    'what time is it',
    '',
    '   ',
  ])('not a help question: %j', (t) => {
    expect(isGhostHelpQuestion(t)).toBe(false);
  });

  it('is bounded and total on odd input', () => {
    expect(isGhostHelpQuestion('stuck '.repeat(40))).toBe(false);
    expect(() => isGhostHelpQuestion('\u0000\ud800 stuck')).not.toThrow();
    for (const t of ['', ' ', '???', '\n\t']) expect(isGhostHelpQuestion(t)).toBe(false);
  });

  it('never matches a classic command (HELP, INFO, vocabulary sentences)', () => {
    const g = newGame(1).game;
    for (const t of ['help', 'info', 'take lamp', 'hint', 'stuck']) {
      if (isClassicCommandText(t, g.zzword, false)) expect(isGhostHelpQuestion(t)).toBe(false);
    }
  });
});