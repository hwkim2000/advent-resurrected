/*
 * Public API of the game engine (task 8.8).
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

import { cloneState } from './init';
import { mainEndOfInput, mainStart, mainStep } from './main-loop';
import { computeScore } from './score';
import { GAMELIMIT } from './objects';
import type { OutputEvent } from './events';
import type { Env, GameState, StepResult } from './types';

export { newGame, cloneState } from './init';
export { render } from './render';
export { serialize, deserialize } from './save-resume';
export { EngineBug } from './types';
export type {
  CommandT,
  Env,
  Game,
  GameOptions,
  GameState,
  Pending,
  Session,
  Settings,
  StepResult,
  Storage,
  Word,
} from './types';
export type { OutputEvent } from './events';

/**
 * Append the derived events (design: Event emission) to a finished step:
 * at most one `lamp-level` when the limit changed, and one `score` when the
 * score changed. Updates the reported_* bookkeeping in the (cloned) session.
 */
function finish(state: GameState, events: OutputEvent[]): StepResult {
  const { game, session } = state;
  if (game.limit !== session.reportedLimit) {
    session.reportedLimit = game.limit;
    events.push({ type: 'lamp-level', life: game.limit, initial: GAMELIMIT });
  }
  const { score, max } = computeScore(game, 'scoregame');
  if (score !== session.reportedScore) {
    session.reportedScore = score;
    events.push({ type: 'score', score, max });
  }
  return { state, events };
}

/** C: main() start-up. Never mutates `state`. */
export function start(
  state: GameState,
  env: Env,
  restoreText?: string,
): StepResult {
  const next = cloneState(state);
  return finish(next, mainStart(next, env, restoreText));
}

/** One line of player input. Never mutates `state`. */
export function step(state: GameState, line: string, env: Env): StepResult {
  const next = cloneState(state);
  return finish(next, mainStep(next, line, env));
}

/** End of file on stdin. Never mutates `state`. */
export function endOfInput(state: GameState, env: Env): StepResult {
  const next = cloneState(state);
  return finish(next, mainEndOfInput(next, env));
}
