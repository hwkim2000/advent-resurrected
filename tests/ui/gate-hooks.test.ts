// Gate registry example tests. Validates: Requirements 13.3, 13.4
import { describe, expect, it, vi } from 'vitest';
import {
  ExtensionHooks,
  type GateResult,
  type HookContext,
  type InputGate,
} from '../../src/ui/extension-hooks';
import type { Logger } from '../../src/ui/types';

const HAUNTED: HookContext = { gameMode: 'haunted', selectedMode: 'haunted', prompt: 'command' };

function setup() {
  const log: Logger = { error: vi.fn() };
  return { hooks: new ExtensionHooks(log), error: log.error as ReturnType<typeof vi.fn> };
}

const allow = (): GateResult => ({ kind: 'allow' });
const deflect = (...lines: string[]): GateResult => ({ kind: 'deflect', lines });

describe('ExtensionHooks input gates', () => {
  it('allows when no gates are registered', () => {
    const { hooks } = setup();
    expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual({ kind: 'allow' });
  });

  it('calls gates in registration order with the arguments', () => {
    const { hooks } = setup();
    const order: string[] = [];
    hooks.addInputGate((t, o, d) => {
      order.push(`a:${t}:${o}:${d}`);
      return allow();
    });
    hooks.addInputGate(() => {
      order.push('b');
      return allow();
    });
    hooks.gateInput('xyzzy', 'spoken', 2, HAUNTED);
    expect(order).toEqual(['a:xyzzy:spoken:2', 'b']);
  });

  it('first deflect wins and later gates are not called', () => {
    const { hooks } = setup();
    const later = vi.fn(allow);
    hooks.addInputGate(allow);
    hooks.addInputGate(() => deflect('one'));
    hooks.addInputGate(() => deflect('two'));
    hooks.addInputGate(later);
    expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual(deflect('one'));
    expect(later).not.toHaveBeenCalled();
  });

  it('accepts deflects of 1 to 3 lines', () => {
    for (const n of [1, 2, 3]) {
      const { hooks } = setup();
      const lines = Array.from({ length: n }, (_, i) => `l${i}`);
      hooks.addInputGate(() => deflect(...lines));
      expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual(deflect(...lines));
    }
  });

  const invalid: [string, () => unknown][] = [
    ['zero lines', () => ({ kind: 'deflect', lines: [] })],
    ['four lines', () => ({ kind: 'deflect', lines: ['a', 'b', 'c', 'd'] })],
    ['empty string entry', () => ({ kind: 'deflect', lines: ['a', ''] })],
    ['non-string entry', () => ({ kind: 'deflect', lines: [1] })],
    ['non-array lines', () => ({ kind: 'deflect', lines: 'abc' })],
    ['Promise', () => Promise.resolve(deflect('late'))],
    ['undefined', () => undefined],
    ['null', () => null],
    ['unknown kind', () => ({ kind: 'block' })],
    ['throw', () => {
      throw new Error('boom');
    }],
  ];

  for (const [name, make] of invalid) {
    it(`logs and treats invalid result as allow: ${name}`, () => {
      const { hooks, error } = setup();
      const next = vi.fn(allow);
      hooks.addInputGate(make as InputGate);
      hooks.addInputGate(next);
      expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual({ kind: 'allow' });
      expect(error).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });
  }

  it('an invalid gate does not stop a later valid deflect', () => {
    const { hooks } = setup();
    hooks.addInputGate((() => ({ kind: 'deflect', lines: [] })) as InputGate);
    hooks.addInputGate(() => deflect('ok'));
    expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual(deflect('ok'));
  });

  it('does not log for valid allow results', () => {
    const { hooks, error } = setup();
    hooks.addInputGate(allow);
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(error).not.toHaveBeenCalled();
  });

  it('calls no gate outside haunted game mode', () => {
    const { hooks } = setup();
    const gate = vi.fn(() => deflect('no'));
    hooks.addInputGate(gate);
    const ctx: HookContext = { gameMode: '1976', selectedMode: 'haunted', prompt: 'command' };
    expect(hooks.gateInput('x', 'spoken', 0, ctx)).toEqual({ kind: 'allow' });
    expect(gate).not.toHaveBeenCalled();
  });

  it('same function registered twice and disposed twice removes only its own registration', () => {
    const { hooks } = setup();
    const gate = vi.fn(allow);
    const d1 = hooks.addInputGate(gate);
    hooks.addInputGate(gate);
    d1();
    d1();
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('disposing the second of two identical registrations leaves the first', () => {
    const { hooks } = setup();
    const gate = vi.fn(allow);
    hooks.addInputGate(gate);
    const d2 = hooks.addInputGate(gate);
    d2();
    d2();
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('a gate added during evaluation does not affect it', () => {
    const { hooks } = setup();
    const added = vi.fn(() => deflect('added'));
    hooks.addInputGate(() => {
      hooks.addInputGate(added);
      return allow();
    });
    expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual({ kind: 'allow' });
    expect(added).not.toHaveBeenCalled();
    expect(hooks.gateInput('x', 'typed', 0, HAUNTED)).toEqual(deflect('added'));
  });

  it('a gate removed during evaluation still runs in that evaluation', () => {
    const { hooks } = setup();
    const second = vi.fn(allow);
    let dispose: () => void = () => undefined;
    hooks.addInputGate(() => {
      dispose();
      return allow();
    });
    dispose = hooks.addInputGate(second);
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(second).toHaveBeenCalledTimes(1);
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('returns a frozen deflect copy, not the gate-owned object', () => {
    const { hooks } = setup();
    const own = { kind: 'deflect', lines: ['a', 'b'] } as const;
    hooks.addInputGate(() => own);
    const out = hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(out).not.toBe(own);
    expect(Object.isFrozen(out)).toBe(true);
    if (out.kind !== 'deflect') throw new Error('expected deflect');
    expect(Object.isFrozen(out.lines)).toBe(true);
    expect(out.lines).not.toBe(own.lines);
    expect(out.lines).toEqual(['a', 'b']);
  });

  it('passes a frozen context to gates', () => {
    const { hooks } = setup();
    let seen: HookContext | undefined;
    hooks.addInputGate((_t, _o, _d, ctx) => {
      seen = ctx;
      return allow();
    });
    hooks.gateInput('x', 'typed', 0, HAUNTED);
    expect(Object.isFrozen(seen)).toBe(true);
  });
});
