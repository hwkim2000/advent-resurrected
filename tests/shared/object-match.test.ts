import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../../src/data/dungeon';
import { validateCommand } from '../../src/shared/command-validation';
import { damerauLevenshtein } from '../../src/shared/edit-distance';
import { pickClosestObject } from '../../src/shared/object-match';
import { damerauLevenshtein as viaVoice } from '../../src/voice/edit-distance';

const word = (name: string): string[] => {
  const found = OBJECTS.find((o) => o.words[0] === name);
  if (found === undefined) throw new Error(`no object ${name}`);
  return [...found.words];
};

describe('shared edit distance', () => {
  it('is re-exported by the voice module', () => {
    expect(viaVoice).toBe(damerauLevenshtein);
    expect(damerauLevenshtein('lab', 'lamp')).toBe(2);
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });
});

describe('pickClosestObject', () => {
  it('turns "grab the lab" into TAKE LAMP when the lamp is visible', () => {
    expect(pickClosestObject('grab the lab', 'TAKE FOOD', [word('food'), word('lamp')])).toBe('TAKE LAMP');
  });

  it('is unchanged when no candidate is close', () => {
    expect(pickClosestObject('grab the lab', 'TAKE FOOD', [word('food'), word('keys')])).toBe('TAKE FOOD');
    expect(pickClosestObject('grab the lab', 'TAKE FOOD', [])).toBe('TAKE FOOD');
  });

  it('keeps the model object when the text supports it', () => {
    expect(pickClosestObject('take the keys', 'TAKE KEYS', [word('lamp'), word('keys')])).toBe('TAKE KEYS');
    expect(pickClosestObject('pick up the key', 'TAKE KEYS', [word('keys'), word('lamp')])).toBe('TAKE KEYS');
    expect(pickClosestObject('grab a snack with ratio', 'TAKE FOOD', [word('lamp')])).toBe('TAKE FOOD');
  });

  it('prefers a prefix match, then distance, then candidate order', () => {
    // "bott" is a prefix of BOTTL; "bird" is closer in letters but not a prefix match.
    expect(pickClosestObject('grab the bott', 'TAKE KEYS', [word('bird'), word('bottl')])).toBe(
      'TAKE BOTTL',
    );
    // "lam" -> lamp (prefix) beats "lab"-like noise from earlier candidates.
    expect(pickClosestObject('get the lam', 'TAKE KEYS', [word('rod'), word('lamp')])).toBe('TAKE LAMP');
    // Equal rank (prefix of both, distance 2): candidate order decides.
    expect(pickClosestObject('grab dra', 'TAKE FOOD', [word('drago'), word('drawi')])).toBe('TAKE DRAGO');
    expect(pickClosestObject('grab dra', 'TAKE FOOD', [word('drawi'), word('drago')])).toBe('TAKE DRAWI');
  });

  it('leaves commands without an object alone', () => {
    expect(pickClosestObject('go inside lab', 'ENTER BUILD', [word('lamp')])).toBe('ENTER BUILD');
  });

  it('always returns a command that passes validateCommand', () => {
    const texts = ['grab the lab', 'take lmap', 'pick up foo', 'drop the cag', 'x', '', '!!! ???', 'get kes'];
    const commands = ['TAKE FOOD', 'DROP KEYS', 'TAKE LAMP', 'ENTER BUILD', 'LIGHT LAMP'];
    const candidates = OBJECTS.filter((o) => o.words.length > 0).map((o) => [...o.words]);
    for (const t of texts) {
      for (const c of commands) {
        const out = pickClosestObject(t, c, candidates);
        expect(validateCommand(out).ok).toBe(true);
      }
    }
  });
});
