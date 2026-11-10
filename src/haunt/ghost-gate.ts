/**
 * Haunted-mode hint gate: at the command prompt, a line that asks the ghost
 * for help (isGhostAsk) is answered with one sarcastic hint line chosen from
 * the first matching rule of the hint table. The gate deflects with
 * `count: false`, so `step` is never called and the engine state, RNG, score
 * and deflection counter stay untouched.
 *
 * New code (not a port). Structural types only; imports nothing from src/ui,
 * src/voice or src/parser.
 */
import type { GameState } from '../engine/index';
import { isGhostAsk } from '../shared/ghost-ask';
import { makeHintView } from './hint-view';
import { selectHintRule } from './hints';
import type { YesNoGateResult, YesNoHookContext } from './yes-no';

export interface GhostGateDeps {
  getState(): GameState | undefined;
}

export interface GhostGate {
  (text: string, origin: unknown, deflections: number, ctx: YesNoHookContext): YesNoGateResult;
  /** Forget the per-game variant counters (a new game starts). */
  reset(): void;
}

export function createGhostGate(deps: GhostGateDeps): GhostGate {
  const occurrence = new Map<string, number>();

  const gate = (
    text: string,
    _origin: unknown,
    _deflections: number,
    ctx: YesNoHookContext,
  ): YesNoGateResult => {
    try {
      if (ctx.prompt !== 'command') return { kind: 'allow' };
      if (!isGhostAsk(text)) return { kind: 'allow' };
      const state = deps.getState();
      if (state === undefined) return { kind: 'allow' };
      const rule = selectHintRule(makeHintView(state));
      if (rule.lines.length === 0) return { kind: 'allow' };
      const n = occurrence.get(rule.id) ?? 0;
      const line = rule.lines[n % rule.lines.length]!;
      occurrence.set(rule.id, n + 1);
      return { kind: 'deflect', lines: [line], count: false };
    } catch {
      return { kind: 'allow' };
    }
  };
  return Object.assign(gate, {
    reset(): void {
      occurrence.clear();
    },
  });
}
