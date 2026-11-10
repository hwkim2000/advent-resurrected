// Haunting task 2.3: TurnInfo delivery, non-counting deflection, and the 'spoken' line kind.
import { describe, expect, it } from 'vitest';
import { serialize } from '../../src/engine/index';
import { decodeAutosave } from '../../src/ui/autosave';
import type { EventObserver, InputGate, NarratorLineProvider, TurnInfo } from '../../src/ui/extension-hooks';
import { AUTOSAVE_KEY } from '../../src/ui/save-store';
import type { InputOrigin } from '../../src/ui/types';
import { makeController } from './support/fakes';
import type { MadeController, MakeControllerOptions } from './support/fakes';

function say(m: MadeController, line: string, origin: InputOrigin = 'typed'): void {
  m.controller.submit(line, origin);
  m.controller.tick(0);
}

/** Registers `register` before the boot so the first present() is seen too. */
function booted(
  opts: MakeControllerOptions,
  register: (m: MadeController) => void,
): MadeController {
  const m = makeController({ ...opts, boot: false });
  register(m);
  m.controller.startBoot();
  m.controller.tick(0);
  m.controller.skip();
  return m;
}

const saved = (m: MadeController) => decodeAutosave(m.kv.get(AUTOSAVE_KEY));

describe('TurnInfo', () => {
  it('reaches providers and observers with before, after, line and origin', () => {
    const seen: { who: string; turn: TurnInfo }[] = [];
    const provider: NarratorLineProvider = (_e, _c, turn) => {
      seen.push({ who: 'provider', turn });
      return [];
    };
    const observer: EventObserver = (_e, _c, turn) => {
      seen.push({ who: 'observer', turn });
    };
    const m = booted({}, (x) => {
      x.hooks.addNarratorLineProvider(provider);
      x.hooks.addEventObserver(observer);
    });

    // Game start: no before state, empty line.
    expect(seen.map((s) => s.who)).toEqual(['observer', 'provider']);
    const start = seen[0]!.turn;
    expect(start.before).toBeUndefined();
    expect(start.line).toBe('');
    expect(start.origin).toBe('typed');
    expect(start.after).toBe(m.controller.engineState);

    seen.length = 0;
    const stateBefore = m.controller.engineState!;
    say(m, 'no', 'spoken');
    expect(seen.map((s) => s.who)).toEqual(['observer', 'provider']);
    for (const s of seen) {
      expect(s.turn.before).toBe(stateBefore);
      expect(s.turn.after).toBe(m.controller.engineState);
      expect(s.turn.after).not.toBe(stateBefore);
      expect(s.turn.line).toBe('no');
      expect(s.turn.origin).toBe('spoken');
    }
  });

  it('carries the transformed line, not the raw one', () => {
    const lines: string[] = [];
    const m = booted({}, (x) => {
      x.hooks.addInputTransformer((l) => (l === 'nope' ? 'NO' : l));
      x.hooks.addEventObserver((_e, _c, turn) => lines.push(turn.line));
    });
    say(m, 'nope');
    expect(lines.at(-1)).toBe('NO');
  });

  it('is never delivered in 1976 mode', () => {
    let calls = 0;
    const m = booted({ mode: '1976' }, (x) => {
      x.hooks.addNarratorLineProvider(() => {
        calls += 1;
        return ['boo'];
      });
      x.hooks.addEventObserver(() => {
        calls += 1;
      });
    });
    say(m, 'no');
    say(m, 'look', 'spoken');
    expect(m.controller.gameMode).toBe('1976');
    expect(calls).toBe(0);
    expect(m.view.textOfKind('narrator')).toBe('');
  });
});

describe('non-counting deflection', () => {
  const deflectAll = (count: false | undefined): InputGate => (text) =>
    text === 'look'
      ? { kind: 'deflect', lines: ['Nope.'], ...(count === false ? { count } : {}) }
      : { kind: 'allow' };

  it('leaves deflections unchanged, skips step and still narrates and persists', () => {
    const m = makeController({ gates: [deflectAll(false)] });
    say(m, 'no');
    const before = serialize(m.controller.engineState!);
    say(m, 'look');
    expect(serialize(m.controller.engineState!)).toBe(before);
    expect(m.view.textOfKind('narrator')).toBe('Nope.\n');
    const s = saved(m)!;
    expect(s.deflections).toBe(0);
    expect(s.lines.map((l) => l.kind).slice(-2)).toEqual(['input', 'narrator']);
    expect(JSON.parse(m.kv.get(AUTOSAVE_KEY)!).ui).toBeUndefined();
    say(m, 'look');
    expect(saved(m)!.deflections).toBe(0);
  });

  it('a plain deflect still counts', () => {
    const m = makeController({ gates: [deflectAll(undefined)] });
    say(m, 'no');
    say(m, 'look');
    expect(saved(m)!.deflections).toBe(1);
  });

  it('keeps count:false only when it is exactly false', () => {
    const m = makeController({
      gates: [() => ({ kind: 'deflect', lines: ['x'], count: true as unknown as false })],
    });
    say(m, 'no');
    say(m, 'look');
    expect(saved(m)!.deflections).toBe(1);
  });
});

describe('spoken line kind', () => {
  it('echoes a spoken line as spoken and a typed line as input', () => {
    const m = makeController();
    say(m, 'no');
    say(m, 'look', 'spoken');
    say(m, 'look', 'typed');
    const echoes = m.view.instantLines.filter((l) => l.kind === 'input' || l.kind === 'spoken');
    expect(echoes.map((l) => l.kind)).toEqual(['input', 'spoken', 'input']);
    expect(echoes[1]!.text).toBe(echoes[2]!.text);
  });

  it('is autosaved and restored with its kind', () => {
    const m = makeController();
    say(m, 'no');
    say(m, 'look', 'spoken');
    expect(saved(m)!.lines.filter((l) => l.kind === 'spoken')).toHaveLength(1);

    const restored = makeController({ kv: m.kv });
    const spoken = restored.view.instantLines.filter((l) => l.kind === 'spoken');
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.text.endsWith('look')).toBe(true);
  });

  it('is echoed as spoken after game over too', () => {
    const m = makeController();
    say(m, 'no');
    say(m, 'quit');
    say(m, 'yes');
    expect(m.controller.phase).toBe('over');
    say(m, 'hello', 'spoken');
    expect(m.view.instantLines.at(-1)!.kind).toBe('spoken');
  });
});
