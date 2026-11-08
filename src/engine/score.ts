/*
 * Scoring and wrap-up for the Open Adventure TypeScript port.
 *
 * Ported from Open Adventure score.c (https://gitlab.com/esr/open-adventure).
 * SPDX-FileCopyrightText: (C) 1977, 2005 by Will Crowther and Don Woods
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

import {
  CHEST,
  GARNERED_POINTS,
  LOC_BUILDING,
  LOC_WITTSEND,
  MAGAZINE,
  NCLASSES,
  NDEATHS,
  NEXT_HIGHER,
  NHINTS,
  NO_HIGHER,
  NOBJECTS,
  OFF_SCALE,
  TOOK_LONG,
  TOTAL_SCORE,
  WITHOUT_SUSPENDS,
} from '../data/constants';
import { CLASSES, HINTS, OBJECTS } from '../data/dungeon';
import { rspeak, speak } from './io';
import type { IoCtx } from './io';
import type { Game, Session } from './types';

/** C: enum termination (advent.h). */
export type Termination = 'endgame' | 'quitgame' | 'scoregame';

/** C: STATE_NOTFOUND (advent.h). */
const STATE_NOTFOUND = -1;
/** C: STATE_FOUND (advent.h). */
const STATE_FOUND = 0;

/** C: score_t values (advent.h): none, splatter, defeat, victory. */
const BONUS_NONE = 0;
const BONUS_SPLATTER = 1;
const BONUS_DEFEAT = 2;
const BONUS_VICTORY = 3;

/**
 * C: score (misc computation part of score.c). Pure: reads `game` and
 * returns the score and `mxscor` (the maximum possible for this state).
 * No clamping is applied (C-3).
 */
export function computeScore(
  game: Game,
  mode: Termination,
): { score: number; max: number } {
  let score = 0;
  let mxscor = 0;

  /* First tally up the treasures. Must be in building and not broken. */
  for (let i = 1; i < NOBJECTS; i++) {
    const def = OBJECTS[i];
    if (def === undefined || !def.isTreasure) continue;
    if (def.inventory !== null) {
      let k = 12;
      if (i === CHEST) k = 14;
      if (i > CHEST) k = 16;
      const obj = game.objects[i];
      if (obj === undefined) continue;
      const stashed = obj.prop < STATE_NOTFOUND;
      const notfound = obj.prop === STATE_NOTFOUND;
      if (!stashed && !notfound) score += 2;
      if (obj.place === LOC_BUILDING && obj.prop === STATE_FOUND) {
        score += k - 2;
      }
      mxscor += k;
    }
  }

  /* How he finished and how far he got. */
  score += (NDEATHS - game.numdie) * 10;
  mxscor += NDEATHS * 10;
  if (mode === 'endgame') score += 4;
  mxscor += 4;
  if (game.dflag !== 0) score += 25;
  mxscor += 25;
  if (game.closng) score += 25;
  mxscor += 25;
  if (game.closed) {
    if (game.bonus === BONUS_NONE) score += 10;
    if (game.bonus === BONUS_SPLATTER) score += 25;
    if (game.bonus === BONUS_DEFEAT) score += 30;
    if (game.bonus === BONUS_VICTORY) score += 45;
  }
  mxscor += 45;

  /* Did he come to Witt's End as he should? */
  if (game.objects[MAGAZINE]?.place === LOC_WITTSEND) score += 1;
  mxscor += 1;

  /* Round it off. */
  score += 2;
  mxscor += 2;

  /* Deduct for hints/turns/saves. */
  for (let i = 0; i < NHINTS; i++) {
    if (game.hints[i]?.used) score -= HINTS[i]?.penalty ?? 0;
  }
  if (game.novice) score -= 5;
  if (game.clshnt) score -= 10;
  score = score - game.trnluz - game.saved;

  return { score, max: mxscor };
}

/**
 * C: score (score.c) - printing wrapper. Speaks GARNERED_POINTS when the
 * mode is scoregame, and returns the score and maximum.
 */
export function scoreGame(
  ctx: IoCtx,
  mode: Termination,
): { score: number; max: number } {
  const result = computeScore(ctx.game, mode);
  if (mode === 'scoregame') {
    const g = ctx.game;
    rspeak(ctx, GARNERED_POINTS, result.score, result.max, g.turns, g.turns);
  }
  return result;
}

/**
 * C: terminate (score.c). Prints the final score and rank, then marks the
 * session as over and emits `game-over` (replaces exit(EXIT_SUCCESS)).
 */
export function terminate(
  ctx: IoCtx,
  session: Session,
  mode: Termination,
): void {
  const game = ctx.game;
  const { score: points, max: mxscor } = scoreGame(ctx, mode);

  if (points + game.trnluz + 1 >= mxscor && game.trnluz !== 0) {
    rspeak(ctx, TOOK_LONG);
  }
  if (points + game.saved + 1 >= mxscor && game.saved !== 0) {
    rspeak(ctx, WITHOUT_SUSPENDS);
  }
  rspeak(ctx, TOTAL_SCORE, points, mxscor, game.turns, game.turns);

  let rank: string | null = null;
  let ranked = false;
  for (let i = 1; i < NCLASSES; i++) {
    const cls = CLASSES[i];
    if (cls !== undefined && cls.threshold >= points) {
      rank = cls.message;
      speak(ctx, cls.message);
      if (i < NCLASSES - 1) {
        const nxt = cls.threshold + 1 - points;
        rspeak(ctx, NEXT_HIGHER, nxt, nxt);
      } else {
        rspeak(ctx, NO_HIGHER);
      }
      ranked = true;
      break;
    }
  }
  if (!ranked) rspeak(ctx, OFF_SCALE);

  const reason = mode === 'quitgame' ? 'quit' : 'endgame';
  session.status = 'over';
  session.exitReason = reason;
  ctx.events.push({
    type: 'game-over',
    score: points,
    rank,
    reason,
    already: false,
  });
}
