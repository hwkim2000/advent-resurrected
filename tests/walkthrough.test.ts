/*
 * Walkthrough: replays the upstream 430-point win (win430.log, with its own
 * in-log `seed` command) through the engine and compares with win430.chk.
 * No command list is authored here; the input is the upstream log, unchanged.
 *
 * Ported from Open Adventure (https://gitlab.com/esr/open-adventure).
 * SPDX-FileCopyrightText: Copyright Eric S. Raymond <esr@thyrsus.com>
 * SPDX-License-Identifier: BSD-2-Clause
 *
 * BSD 2-Clause License. Redistribution and use in source and binary forms, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

import { describe, expect, it } from 'vitest';
import { endOfInput, newGame, render, start, step } from '../src/engine/index';
import type { Env } from '../src/engine/index';
import {
  MemoryStorage,
  STATIC_FIXTURES,
  HARNESS_DEFAULT_SEED,
  parseOptions,
  readUpstream,
  replayLog,
  splitLog,
} from './replay-harness';

const NAME = 'win430';

const clip = (s: string): string =>
  s.length > 400 ? `${JSON.stringify(s.slice(0, 400))}...` : JSON.stringify(s);

/**
 * On a mismatch, find the first turn (1-based; turn 0 is the opening text)
 * whose cumulative output stops matching the expected output, and describe it.
 */
function describeFirstBadTurn(expected: string): string {
  const logText = readUpstream(`${NAME}.log`);
  const lines = splitLog(logText);
  const env: Env = { storage: new MemoryStorage(STATIC_FIXTURES) };
  let state = newGame(HARNESS_DEFAULT_SEED, { oldstyle: parseOptions(logText).oldstyle });
  let produced = '';
  const check = (turn: number, command: string, segment: string): string | undefined => {
    const before = produced.length;
    produced += segment;
    if (expected.startsWith(produced)) return undefined;
    const expectedSegment = expected.slice(before, before + Math.max(segment.length, 1));
    return (
      `first differing turn ${turn}, command ${clip(command)}\n` +
      `  expected: ${clip(expectedSegment)}\n` +
      `  actual:   ${clip(segment)}`
    );
  };
  const first = start(state, env, undefined);
  state = first.state;
  const bad0 = check(0, '<start>', render(first.events, { echo: true }));
  if (bad0 !== undefined) return bad0;
  for (let i = 0; i < lines.length; i++) {
    if (state.session.status === 'over') break;
    const command = lines[i] as string;
    const r = step(state, command, env);
    state = r.state;
    const bad = check(i + 1, command, render(r.events, { echo: true }));
    if (bad !== undefined) return bad;
  }
  if (state.session.status !== 'over') {
    const r = endOfInput(state, env);
    const bad = check(lines.length + 1, '<end of input>', render(r.events, { echo: true }));
    if (bad !== undefined) return bad;
  }
  return `output is a prefix mismatch: expected length ${expected.length}, actual ${produced.length}`;
}

describe('walkthrough: win430', () => {
  const expected = readUpstream(`${NAME}.chk`);
  const run = replayLog(NAME);

  it('replays without an engine error', () => {
    expect(run.error).toBeUndefined();
  });

  it('output equals win430.chk', () => {
    if (run.output !== expected) expect.fail(`${NAME}: ${describeFirstBadTurn(expected)}`);
  });

  it('final score is exactly 430 and the game is over', () => {
    const over = run.events.filter((e) => e.type === 'game-over');
    expect(over.length).toBeGreaterThanOrEqual(1);
    const last = over[over.length - 1];
    expect(last?.type === 'game-over' ? last.score : undefined).toBe(430);
    expect(run.finalState?.session.status).toBe('over');
  });

  it('processes every command in the log', () => {
    expect(run.totalLines).toBeGreaterThan(0);
    expect(run.linesProcessed).toBe(run.totalLines);
  });

  it('is identical across two consecutive runs', () => {
    const again = replayLog(NAME);
    expect(again.output).toBe(run.output);
    expect(again.events).toEqual(run.events);
  });
});
