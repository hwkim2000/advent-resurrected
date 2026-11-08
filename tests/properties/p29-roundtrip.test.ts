// Feature: game-engine, Property 29: Serialization round trip and continuation
// **Validates: Requirements 3.5, 9.8, 13.1, 13.2, 13.3, 16.3**
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { step } from '../../src/engine';
import type { GameState, OutputEvent } from '../../src/engine';
import { deserialize, serialize } from '../../src/engine/save-resume';
import {
  assertProperty,
  makeEnv,
  replayCommands,
  seedArb,
  vocabCommands,
} from '../support/generators';

function run(
  initial: GameState,
  commands: readonly string[],
): { state: GameState; events: OutputEvent[] } {
  const env = makeEnv();
  let state = initial;
  const events: OutputEvent[] = [];
  for (const line of commands) {
    if (state.session.status === 'over') break;
    const r = step(state, line, env);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('Property 29: Serialization round trip and continuation', () => {
  it('deserialize(serialize(s)) deeply equals s for states reached by up to 100 commands', () => {
    assertProperty(
      fc.property(seedArb, vocabCommands(100), (seed, cmds) => {
        const { state } = replayCommands(seed, cmds);
        const result = deserialize(serialize(state));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.state).toEqual(state);
      }),
    );
  });

  it('original and restored states produce deeply equal events for any further commands', () => {
    assertProperty(
      fc.property(seedArb, vocabCommands(100), vocabCommands(40), (seed, cmds, more) => {
        const { state } = replayCommands(seed, cmds);
        const result = deserialize(serialize(state));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const a = run(state, more);
        const b = run(result.state, more);
        expect(b.events).toEqual(a.events);
        expect(b.state).toEqual(a.state);
      }),
    );
  });

  it('round-trips the freshly started state', () => {
    const { state } = replayCommands(1, []);
    const r = deserialize(serialize(state));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(state);
  });
});
