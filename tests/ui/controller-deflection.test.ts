// Task 6.4: controller Deflection example tests, with the real Spoken_Word_Rule gate.
// Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.9, 12.14, 12.15, 12.16, 12.17, 13.14, 18.8
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/engine/index';
import { DEFLECTION_LINE, createSpokenWordGate } from '../../src/haunt/spoken-word-rule';
import { decodeAutosave } from '../../src/ui/autosave';
import type { GateResult, InputGate } from '../../src/ui/extension-hooks';
import { AUTOSAVE_KEY } from '../../src/ui/save-store';
import type { InputOrigin } from '../../src/ui/types';
import { FailingKeyValueStore, ScriptedResolver, makeController as makeRaw } from './support/fakes';
import type { MadeController, MakeControllerOptions } from './support/fakes';

interface Setup extends MadeController {
  usable: { value: boolean };
  decisions: { text: string; origin: InputOrigin; kind: GateResult['kind'] }[];
}

/** Controller with the real gate; the intro (instructions) prompt is answered. */
function setup(opts: MakeControllerOptions = {}, answerIntro = true): Setup {
  const usable = { value: true };
  const decisions: Setup['decisions'] = [];
  const real = createSpokenWordGate({ isVoiceUsable: () => usable.value });
  const gate: InputGate = (text, origin, deflections, ctx) => {
    const r = real(text, origin, deflections, ctx);
    decisions.push({ text, origin, kind: r.kind });
    return r;
  };
  const made = makeRaw({ ...opts, gates: [gate] });
  if (answerIntro) say(made, 'no');
  return { ...made, usable, decisions };
}

function say(m: MadeController, line: string, origin: InputOrigin = 'typed'): void {
  m.controller.submit(line, origin);
  m.controller.tick(0);
}

/** Reveals pending output and delivers queued lines until nothing is left. */
function drain(m: MadeController): void {
  for (let i = 0; i < 20; i += 1) m.controller.skip();
}

const narratorCount = (m: MadeController): number =>
  m.view.blocks.filter((b) => b.kind === 'narrator' && b.text === DEFLECTION_LINE + '\n').length;

const stateText = (m: MadeController): string => serialize(m.controller.engineState!);

const saved = (m: MadeController) => decodeAutosave(m.kv.get(AUTOSAVE_KEY));

const savedUi = (m: MadeController): unknown => {
  const raw = m.kv.get(AUTOSAVE_KEY);
  return raw === null ? undefined : (JSON.parse(raw) as { ui?: unknown }).ui;
};

const kinds = (m: MadeController): string[] => (saved(m)?.lines ?? []).map((l) => l.kind);

describe('controller Deflection', () => {
  it('deflects a typed XYZZY exactly once per game', () => {
    const m = setup();
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    const afterFirst = stateText(m);
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    expect(stateText(m)).not.toBe(afterFirst); // the second one reached step
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    expect(m.decisions.filter((d) => d.kind === 'deflect')).toHaveLength(1);
  });

  it('keeps the echo and adds one narrator line and no original line', () => {
    const m = setup();
    const before = saved(m)!.lines.length;
    say(m, 'xyzzy');
    const added = saved(m)!.lines.slice(before);
    expect(added.map((l) => l.kind)).toEqual(['input', 'narrator']);
    expect(added[0]!.text.endsWith('xyzzy')).toBe(true);
    expect(added[1]!.text).toBe(DEFLECTION_LINE);
    expect(m.log.entries).toEqual([]);
  });

  it('keeps an AI Translation_Line before the Deflection_Line and does not accept the command', () => {
    const resolver = new ScriptedResolver();
    resolver.needs = (line) => line === 'say the magic word';
    resolver.outcome = () => ({ kind: 'translated', command: 'xyzzy' });
    const m = setup({ resolver });
    const before = saved(m)!.lines.length;
    const accepted = resolver.acceptedLines.length;
    say(m, 'say the magic word');
    return Promise.resolve()
      .then(() => new Promise<void>((r) => setTimeout(r, 0)))
      .then(() => {
        m.controller.tick(0);
        const added = saved(m)!.lines.slice(before);
        expect(added.map((l) => l.kind)).toEqual(['input', 'translation', 'narrator']);
        expect(added[2]!.text).toBe(DEFLECTION_LINE);
        expect(resolver.acceptedLines.length).toBe(accepted);
      });
  });

  it('leaves the serialized state and the RNG byte-identical', () => {
    const m = setup();
    const before = stateText(m);
    const lcg = m.controller.engineState!.game.lcg_x;
    say(m, 'go xyzzy');
    expect(narratorCount(m)).toBe(1);
    expect(stateText(m)).toBe(before);
    expect(m.controller.engineState!.game.lcg_x).toBe(lcg);
  });

  it('writes the autosave right after the Deflection and keeps ui after the next step', () => {
    const m = setup();
    m.kv.remove(AUTOSAVE_KEY);
    say(m, 'xyzzy');
    expect(savedUi(m)).toEqual({ deflections: 1 });
    expect(saved(m)!.deflections).toBe(1);
    say(m, 'look');
    expect(savedUi(m)).toEqual({ deflections: 1 });
    say(m, 'xyzzy'); // let through
    expect(savedUi(m)).toEqual({ deflections: 1 });
    expect(narratorCount(m)).toBe(1);
  });

  it('writes no ui field before any Deflection', () => {
    const m = setup();
    say(m, 'look');
    expect(savedUi(m)).toBeUndefined();
  });

  it('keeps the count across a restore, so the next typed XYZZY is not deflected', () => {
    const first = setup();
    say(first, 'xyzzy');
    say(first, 'look');
    const second = setup({ kv: first.kv }, false);
    expect(second.controller.phase).toBe('ready');
    say(second, 'xyzzy');
    expect(narratorCount(second)).toBe(0);
    expect(second.decisions.map((d) => d.kind)).toEqual(['allow']);
  });

  it('restores an autosave without ui as 0', () => {
    const first = setup();
    say(first, 'look');
    expect(savedUi(first)).toBeUndefined();
    const second = setup({ kv: first.kv }, false);
    say(second, 'xyzzy');
    expect(narratorCount(second)).toBe(1);
  });

  describe('resets to 0', () => {
    it('on boot, after an invalid autosave and after a cleared autosave', () => {
      const boot = setup();
      say(boot, 'xyzzy');
      expect(narratorCount(boot)).toBe(1);

      const invalid = setup({ deflections: 1 });
      invalid.kv.set(AUTOSAVE_KEY, '{not json');
      const afterInvalid = setup({ kv: invalid.kv });
      say(afterInvalid, 'xyzzy');
      expect(narratorCount(afterInvalid)).toBe(1);

      const cleared = setup({ deflections: 1 });
      cleared.kv.remove(AUTOSAVE_KEY);
      const afterCleared = setup({ kv: cleared.kv });
      say(afterCleared, 'xyzzy');
      expect(narratorCount(afterCleared)).toBe(1);
    });

    it('on the restart offer after a game ended', () => {
      const m = setup();
      say(m, 'xyzzy');
      say(m, 'quit');
      say(m, 'yes');
      expect(m.controller.phase).toBe('over');
      say(m, '');
      expect(m.controller.phase).toBe('ready');
      say(m, 'no');
      say(m, 'xyzzy');
      expect(narratorCount(m)).toBe(2);
    });

    it('on a mode change that starts a game', () => {
      const m = setup();
      say(m, 'xyzzy');
      m.controller.setMode('1976');
      m.controller.requestNewGame();
      expect(m.controller.gameMode).toBe('1976');
      m.controller.setMode('haunted');
      m.controller.requestNewGame();
      expect(m.controller.gameMode).toBe('haunted');
      say(m, 'no');
      say(m, 'xyzzy');
      expect(narratorCount(m)).toBe(2);
    });
  });

  it('is not reset by a death and reincarnation in the same game', () => {
    const m = setup();
    say(m, 'seed 780351908');
    say(m, 'enter building');
    say(m, 'xyzzy'); // deflected
    expect(narratorCount(m)).toBe(1);
    say(m, 'xyzzy'); // to the debris room
    say(m, 's'); // pitfall
    const dead = m.view.textOfKind('original');
    expect(dead).toContain('reincarnate');
    say(m, 'y');
    expect(m.controller.phase).toBe('ready');
    expect(savedUi(m)).toEqual({ deflections: 1 });
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    expect(m.decisions.filter((d) => d.kind === 'deflect')).toHaveLength(1);
  });

  it('is not changed by an engine RESUME (a SAVE ends the game, so it has no count to change)', () => {
    const m = setup();
    say(m, 'look');
    say(m, 'save');
    say(m, 'y');
    say(m, 'deflect.adv');
    expect(m.controller.phase).toBe('over');
    say(m, ''); // new game: count 0
    say(m, 'no');
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    say(m, 'resume');
    say(m, 'deflect.adv');
    expect(m.controller.phase).toBe('ready');
    expect(m.controller.promptKind).toBe('command');
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1); // still 1: the count survived the RESUME
    expect(m.decisions.filter((d) => d.kind === 'deflect')).toHaveLength(1);
    expect(m.log.entries).toEqual([]);
  });
  it('processes queued XYZZY lines in FIFO order and deflects only the first', () => {
    const m = setup({ speed: 20 });
    m.controller.submit('xyzzy');
    m.controller.submit('go xyzzy');
    m.controller.submit('say xyzzy');
    // Slow teletype: every line, the intro answer included, is still queued.
    expect(m.decisions).toEqual([]);
    drain(m);
    expect(m.decisions.map((d) => [d.text, d.kind])).toEqual([
      ['no', 'allow'],
      ['xyzzy', 'deflect'],
      ['go xyzzy', 'allow'],
      ['say xyzzy', 'allow'],
    ]);
    expect(narratorCount(m)).toBe(1);
  });

  it('still shows the line and lets the next XYZZY through when the autosave write fails', () => {
    const kv = new FailingKeyValueStore();
    const m = setup({ kv });
    kv.failSet = true;
    const attempts = kv.setAttempts;
    say(m, 'xyzzy');
    expect(kv.setAttempts).toBeGreaterThan(attempts);
    expect(narratorCount(m)).toBe(1);
    expect(m.log.entries).toEqual([]);
    expect(m.view.textOfKind('notice')).not.toMatch(/ERROR|FAIL/i);
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
    expect(m.decisions.filter((d) => d.kind === 'deflect')).toHaveLength(1);
  });

  it('stops deflecting when voice becomes unavailable, including queued lines', () => {
    const m = setup({ speed: 20 });
    m.controller.submit('look');
    m.controller.submit('xyzzy'); // queued behind pending output
    expect(m.decisions).toEqual([]);
    m.usable.value = false;
    drain(m);
    expect(narratorCount(m)).toBe(0);
    expect(m.decisions.at(-1)).toMatchObject({ text: 'xyzzy', kind: 'allow' });
    // The count was retained (not consumed): usable again deflects once.
    m.usable.value = true;
    say(m, 'xyzzy');
    expect(narratorCount(m)).toBe(1);
  });

  it('never deflects a spoken XYZZY and leaves the count alone', () => {
    const m = setup();
    say(m, 'xyzzy', 'spoken');
    expect(narratorCount(m)).toBe(0);
    expect(savedUi(m)).toBeUndefined();
    say(m, 'xyzzy'); // typed: the count was still 0
    expect(narratorCount(m)).toBe(1);
  });

  it('uses the identical Deflection_Line in two games', () => {
    const a = setup();
    say(a, 'xyzzy');
    const b = setup();
    say(b, 'xyzzy');
    const lineOf = (m: MadeController) =>
      m.view.blocks.filter((x) => x.kind === 'narrator').map((x) => x.text);
    expect(lineOf(a)).toEqual([DEFLECTION_LINE + '\n']);
    expect(lineOf(b)).toEqual(lineOf(a));
  });
});
