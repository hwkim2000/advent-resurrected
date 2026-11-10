// Haunting task 5.3: yes/no aliases, nudge gate and the spoken-XYZZY reaction.
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/engine/index';
import { createHaunting } from '../../src/haunt/haunting';
import type { HauntEffectsPort } from '../../src/haunt/haunting';
import { SPOKEN_XYZZY_LINES } from '../../src/haunt/lines';
import { DEFLECTION_LINE, createSpokenWordGate } from '../../src/haunt/spoken-word-rule';
import { NUDGE_LINES, aliasAnswer, createYesNoGate, transformYesNo } from '../../src/haunt/yes-no';
import type { InputOrigin } from '../../src/ui/types';
import { FakeMotion, makeController } from '../ui/support/fakes';
import type { MadeController } from '../ui/support/fakes';
import { logLines } from './support';

const NOOP_FX: HauntEffectsPort = {
  setDim() {},
  flashGlitch() {},
  reincarnate() {},
  reset() {},
};

function say(m: MadeController, line: string, origin: InputOrigin = 'typed'): void {
  m.controller.submit(line, origin);
  m.controller.tick(0);
}

function setup(mode: 'haunted' | '1976' = 'haunted', withHaunting = true): MadeController {
  const m = makeController({ mode });
  m.hooks.addInputGate(createSpokenWordGate({ isVoiceUsable: () => true }));
  if (withHaunting) {
    createHaunting({ hooks: m.hooks, effects: NOOP_FX, motion: new FakeMotion(false), seed: 3 }).gameStart(
      m.controller.engineState,
    );
  }
  return m;
}

const narrator = (m: MadeController): string => m.view.textOfKind('narrator');
const state = (m: MadeController): string => serialize(m.controller.engineState!);

describe('yes/no aliases', () => {
  it.each(['sure', 'ok', 'okay', 'please', 'Sure!', 'of course', 'yes please'])('%j -> YES', (t) => {
    expect(aliasAnswer(t)).toBe('YES');
    expect(transformYesNo(t, { gameMode: 'haunted', prompt: 'yesno' })).toBe('YES');
  });
  it.each(['nope', 'nah', 'no thanks', 'No thank you.', 'never'])('%j -> NO', (t) => {
    expect(aliasAnswer(t)).toBe('NO');
    expect(transformYesNo(t, { gameMode: 'haunted', prompt: 'yesno' })).toBe('NO');
  });
  it('leaves other prompts and other text alone', () => {
    expect(transformYesNo('sure', { gameMode: 'haunted', prompt: 'command' })).toBe('sure');
    expect(transformYesNo('sure', { gameMode: 'haunted', prompt: 'filename' })).toBe('sure');
    expect(transformYesNo('yes', { gameMode: 'haunted', prompt: 'yesno' })).toBe('yes');
    expect(transformYesNo('maybe', { gameMode: 'haunted', prompt: 'yesno' })).toBe('maybe');
  });
  it('reaches the engine as YES/NO at the instructions prompt', () => {
    const a = setup();
    const b = setup('haunted', false);
    say(a, 'nope');
    say(b, 'no');
    expect(state(a)).toBe(state(b));
    expect(a.view.textOfKind('original')).toBe(b.view.textOfKind('original'));
  });
});

describe('nudges', () => {
  it('has at least 3 plain ASCII lines of at most 160 chars, each with a YES or NO cue', () => {
    expect(NUDGE_LINES.length).toBeGreaterThanOrEqual(3);
    for (const l of NUDGE_LINES) {
      expect(l.length).toBeLessThanOrEqual(160);
      expect(l).toMatch(/^[\x20-\x7e]+$/);
      expect(l).toMatch(/\bYES\b|\bNO\b/);
    }
  });

  it('gate allows y/n words and never acts at command or filename prompts', () => {
    const g = createYesNoGate();
    const y = { gameMode: 'haunted', prompt: 'yesno' } as const;
    for (const t of ['yes', 'y', 'No', 'nothing', '  yep']) expect(g(t, 'typed', 0, y).kind).toBe('allow');
    for (const t of ['maybe', '', 'what?']) expect(g(t, 'typed', 0, y).kind).toBe('deflect');
    for (const prompt of ['command', 'filename'] as const) {
      expect(g('maybe', 'typed', 0, { gameMode: 'haunted', prompt }).kind).toBe('allow');
    }
  });

  it('unrelated text shows a rotating nudge and leaves engine, deflections and XYZZY hint untouched', () => {
    const m = setup();
    const before = state(m);
    say(m, 'purple elephants');
    say(m, 'what is this');
    say(m, 'hmm');
    const shown = narrator(m);
    for (const n of NUDGE_LINES.slice(0, 3)) expect(shown).toContain(n);
    expect(state(m)).toBe(before);
    expect(m.view.textOfKind('original')).not.toContain('Please answer the question');
    // Answer for real, then the XYZZY deflection is still available.
    say(m, 'sure');
    say(m, 'xyzzy');
    expect(narrator(m)).toContain(DEFLECTION_LINE);
  });

  it('1976 mode still shows the engine text', () => {
    const m = setup('1976');
    say(m, 'purple elephants');
    expect(m.view.textOfKind('original')).toContain('Please answer the question.');
    expect(narrator(m)).toBe('');
  });

  it('the reincarnation prompt accepts "sure"', () => {
    const m = setup();
    const lines = logLines('reincarnate');
    while (lines[lines.length - 1] === '') lines.pop();
    for (const l of lines.slice(0, -1)) say(m, l);
    const out = m.view.textOfKind('original');
    say(m, 'sure');
    expect(m.view.textOfKind('original').length).toBeGreaterThan(out.length);
    expect(m.view.textOfKind('original').slice(out.length)).not.toContain('Please answer');
    expect(narrator(m)).not.toContain(NUDGE_LINES[0]!);
  });
});

describe('spoken XYZZY', () => {
  it('is never deflected, reaches the engine and gets the narrator reaction', () => {
    const m = setup();
    say(m, 'no');
    const before = state(m);
    say(m, 'xyzzy', 'spoken');
    expect(state(m)).not.toBe(before);
    const n = narrator(m);
    expect(n).not.toContain(DEFLECTION_LINE);
    expect(SPOKEN_XYZZY_LINES.some((l) => n.includes(l))).toBe(true);
  });

  it('typed XYZZY gets no spoken reaction', () => {
    const m = setup();
    say(m, 'no');
    say(m, 'xyzzy');
    say(m, 'xyzzy');
    expect(SPOKEN_XYZZY_LINES.some((l) => narrator(m).includes(l))).toBe(false);
  });
});
