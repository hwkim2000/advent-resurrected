import { describe, expect, it } from 'vitest';
import {
  DEFLECTION_LINE,
  createSpokenWordGate,
  type SpokenWordHookContext,
  type SpokenWordMode,
  type SpokenWordPromptKind,
} from '../../src/haunt/spoken-word-rule';

const DEFLECTED = ['xyzzy', 'XYZZY', 'go xyzzy', 'say xyzzy', 'plugh xyzzy'];

function ctx(
  gameMode: SpokenWordMode = 'haunted',
  prompt: SpokenWordPromptKind = 'command',
): SpokenWordHookContext {
  return { gameMode, selectedMode: gameMode, prompt };
}

describe('Deflection_Line', () => {
  it('is a short ASCII narrator line naming aloud, mic, Alt+M and typing again', () => {
    expect(DEFLECTION_LINE.length).toBeLessThanOrEqual(160);
    expect(DEFLECTION_LINE).toMatch(/^[\x20-\x7e]+$/);
    expect(DEFLECTION_LINE).not.toBe(DEFLECTION_LINE.toUpperCase());
    expect(DEFLECTION_LINE).toContain('aloud');
    expect(DEFLECTION_LINE).toContain('mic');
    expect(DEFLECTION_LINE).toContain('Alt+M');
    expect(DEFLECTION_LINE).toContain('type it again');
  });
});

describe('Spoken_Word_Rule gate', () => {
  const usable = createSpokenWordGate({ isVoiceUsable: () => true });

  it.each(DEFLECTED)('deflects typed %j with the fixed line', (text) => {
    expect(usable(text, 'typed', 0, ctx())).toEqual({ kind: 'deflect', lines: [DEFLECTION_LINE] });
  });

  it.each(DEFLECTED)('does not deflect spoken %j', (text) => {
    expect(usable(text, 'spoken', 0, ctx()).kind).toBe('allow');
  });

  it.each(['plugh', 'plover', 'fee', 'fie', 'foe', 'foo', 'fee fie', 'look', 'go north', ''])(
    'does not deflect other typed text %j',
    (text) => {
      expect(usable(text, 'typed', 0, ctx()).kind).toBe('allow');
    },
  );

  it.each<SpokenWordPromptKind>(['yesno', 'filename'])('does not deflect at a %s prompt', (prompt) => {
    expect(usable('xyzzy', 'typed', 0, ctx('haunted', prompt)).kind).toBe('allow');
  });

  it('does not deflect in Mode_1976', () => {
    expect(usable('xyzzy', 'typed', 0, ctx('1976')).kind).toBe('allow');
  });

  it('does not deflect once the limit of one Deflection is reached', () => {
    expect(usable('xyzzy', 'typed', 1, ctx()).kind).toBe('allow');
  });

  // Unsupported, Unavailable and Suspended all make voice not usable.
  it.each(['Unsupported', 'Unavailable', 'Suspended'])(
    'does not deflect when availability is %s',
    () => {
      const unusable = createSpokenWordGate({ isVoiceUsable: () => false });
      for (const text of DEFLECTED) expect(unusable(text, 'typed', 0, ctx()).kind).toBe('allow');
    },
  );

  it('reads voice usability at each call', () => {
    let ok = false;
    const gate = createSpokenWordGate({ isVoiceUsable: () => ok });
    expect(gate('xyzzy', 'typed', 0, ctx()).kind).toBe('allow');
    ok = true;
    expect(gate('xyzzy', 'typed', 0, ctx()).kind).toBe('deflect');
  });
});
