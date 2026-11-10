import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloneState, newGame, start, step } from '../../src/engine';
import type { GameState, OutputEvent } from '../../src/engine';
import type { TurnInfo } from '../../src/haunt/moments';
import { makeEnv } from '../support/generators';

export interface RecordedTurn {
  readonly turn: TurnInfo;
  readonly events: readonly OutputEvent[];
}

const TESTS_DIR = fileURLToPath(new URL('../../reference/open-adventure/tests/', import.meta.url));

/** Input lines of an upstream .log (comment lines dropped; "seed N" is an in-game verb). */
export function logLines(name: string): string[] {
  return readFileSync(`${TESTS_DIR}${name}.log`, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => !l.startsWith('#'));
}

/** Play `lines` from a fresh game (engine seed 0, like the fidelity harness), recording each turn. */
export function playLines(lines: readonly string[], seed = 0): RecordedTurn[] {
  const env = makeEnv();
  const turns: RecordedTurn[] = [];
  const first = start(newGame(seed), env);
  let state = first.state;
  turns.push({
    turn: { before: undefined, after: state, line: '', origin: 'typed' },
    events: first.events,
  });
  for (const line of lines) {
    if (state.session.status === 'over') break;
    const r = step(state, line, env);
    turns.push({ turn: { before: state, after: r.state, line, origin: 'typed' }, events: r.events });
    state = r.state;
  }
  return turns;
}

export function playLog(name: string): RecordedTurn[] {
  return playLines(logLines(name));
}

/** A fresh state and a mutated clone of it, as a TurnInfo. */
export function makeTurn(
  mutate: (g: GameState) => void = () => {},
  opts: { line?: string; origin?: 'typed' | 'spoken'; prepare?: (g: GameState) => void } = {},
): TurnInfo {
  const before = cloneState(newGame(0));
  opts.prepare?.(before);
  const after = cloneState(before);
  mutate(after);
  return { before, after, line: opts.line ?? '', origin: opts.origin ?? 'typed' };
}
