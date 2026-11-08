// Feature: crt-terminal-ui, Property 18: Autosave round trip
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newGame, serialize, start, step } from '../../../src/engine/index';
import type { Env, GameState, OutputEvent } from '../../../src/engine/index';
import { decodeAutosave, encodeAutosave } from '../../../src/ui/autosave';
import { lastPromptOf, originalTextOf, splitIntoLines } from '../../../src/ui/event-render';
import type { PromptInfo, TranscriptLine } from '../../../src/ui/types';
import { arbCommandSequence, arbTranscriptLine } from '../support/generators';

/** In-memory engine Storage; `fork` copies its files so two runs stay independent. */
function makeEnv(files?: Map<string, string>): { env: Env; files: Map<string, string> } {
  const f = new Map(files ?? []);
  return {
    files: f,
    env: {
      storage: {
        read: (name) => f.get(name),
        write: (name, data) => {
          f.set(name, data);
          return true;
        },
      },
    },
  };
}

interface Played {
  state: GameState;
  prompt: PromptInfo;
  lines: TranscriptLine[];
  text: string;
}

/** Play commands from a state; stops feeding input once the session is over. */
function play(state: GameState, env: Env, commands: readonly string[], startEvents?: OutputEvent[]): Played {
  let cur = state;
  let prompt: PromptInfo = { kind: 'command', text: '' };
  let text = '';
  const lines: TranscriptLine[] = [];
  const take = (events: OutputEvent[]): void => {
    const t = originalTextOf(events);
    text += t;
    lines.push(...splitIntoLines(t, 'original'));
    const p = lastPromptOf(events);
    if (p) prompt = p;
  };
  if (startEvents) take(startEvents);
  for (const c of commands) {
    if (cur.session.status !== 'running') break;
    const r = step(cur, c, env);
    cur = r.state;
    take(r.events);
  }
  return { state: cur, prompt, lines, text };
}

describe('Property 18: Autosave round trip', () => {
  /** **Validates: Requirements 9.2, 9.8** */
  it('restoring an autosave and playing on equals continuing the original state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.boolean(),
        arbCommandSequence,
        arbCommandSequence,
        fc.array(arbTranscriptLine, { maxLength: 10 }),
        (seed, oldstyle, first, second, extraLines) => {
          const a = makeEnv();
          const s0 = start(newGame(seed, { oldstyle }), a.env);
          const reached = play(s0.state, a.env, first, s0.events);
          // Autosave only holds running games (decode rejects finished ones).
          fc.pre(reached.state.session.status === 'running');

          const transcript = [...reached.lines, ...extraLines];
          const json = encodeAutosave(reached.state, reached.prompt, transcript);
          expect(json).toBeDefined();
          const restored = decodeAutosave(json!);
          expect(restored).toBeDefined();

          // Mode, prompt and transcript lines come back unchanged.
          expect(restored!.state.session.settings.oldstyle).toBe(oldstyle);
          expect(restored!.prompt).toEqual(reached.prompt);
          const expectedLines = transcript.filter((l) => l.kind !== 'boot').slice(-200);
          expect(restored!.lines).toEqual(expectedLines);
          expect(serialize(restored!.state)).toBe(serialize(reached.state));

          // Further play from both states, with identical storage contents.
          const b = makeEnv(a.files);
          const c = makeEnv(a.files);
          const orig = play(reached.state, b.env, second);
          const rest = play(restored!.state, c.env, second);
          expect(rest.text).toBe(orig.text);
          expect(serialize(rest.state)).toBe(serialize(orig.state));
          expect(rest.state.session.settings.oldstyle).toBe(oldstyle);
        },
      ),
      { numRuns: 100 },
    );
  });
});
