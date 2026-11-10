import { describe, expect, it } from 'vitest';
import { XYZZY } from '../../src/data/constants';
import { containsXyzzyMotionWord } from '../../src/haunt/spoken-word-rule';
import { lookupWord } from '../../src/shared/vocabulary';

describe('XYZZY vocabulary id', () => {
  it.each(['xyzzy', 'XYZZY'])('lookupWord(%j) is the XYZZY motion', (w) => {
    const hit = lookupWord(w);
    expect(hit?.cls).toBe('motion');
    expect(hit?.id).toBe(XYZZY);
  });

  it.each(['go xyzzy', 'say xyzzy', 'plugh xyzzy'])('%j contains the XYZZY word as its second word', (text) => {
    const word = text.split(' ')[1]!;
    expect(lookupWord(word)?.id).toBe(XYZZY);
    expect(containsXyzzyMotionWord(text)).toBe(true);
  });
});
