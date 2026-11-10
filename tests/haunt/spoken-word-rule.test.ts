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
  it('is the exact 66-character line naming ALOUD, MIC and ALT+M', () => {
    expect(DEFLECTION_LINE).toBe('SAY IT ALOUD. HOLD THE MIC OR ALT+M. TYPE XYZZY AGAIN IF YOU MUST.');
    expect(DEFLECTION_LINE).toHaveLength(66);
    expect(DEFLECTION_LINE.length).toBeLessThanOrEqual(80);
    expect(DEFLECTION_LINE).toContain('ALOUD');
    expect(DEFLECTION_LINE).toContain('MIC');
    expect(DEFLECTION_LINE).toContain('ALT+M');
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
