/*
 * Open Adventure's LCG random number generator, ported to TypeScript.
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

import type { Env, Game } from './types';

/** C: LCG_A, LCG_C, LCG_M (advent.h). */
export const LCG_A = 1093;
export const LCG_C = 221587;
export const LCG_M = 1048576;

/** Subset of Env that the RNG needs. */
type RngEnv = Pick<Env, 'rngTrace'>;

/** C: get_next_lcg_value (misc.c). Returns the current value, then iterates. */
export function getNextLcgValue(game: Pick<Game, 'lcg_x'>, env?: RngEnv): number {
  const oldX = game.lcg_x | 0;
  // 1093 * (2^20 - 1) + 221587 < 2^31, so plain arithmetic is exact.
  game.lcg_x = (LCG_A * game.lcg_x + LCG_C) % LCG_M;
  if (env?.rngTrace) env.rngTrace(oldX);
  return oldX;
}

/** C: randrange (misc.c). Integer in [0, range). int32 multiply as in C. */
export function randrange(game: Pick<Game, 'lcg_x'>, range: number, env?: RngEnv): number {
  const v = getNextLcgValue(game, env);
  return Math.trunc(Math.imul(range | 0, v) / LCG_M);
}

/** C: PCT(N) (advent.h). True N% of the time. */
export function pct(game: Pick<Game, 'lcg_x'>, n: number, env?: RngEnv): boolean {
  return randrange(game, 100, env) < n;
}

/** C: set_seed (misc.c). */
export function setSeed(
  game: Pick<Game, 'lcg_x' | 'zzword'>,
  seedval: number,
  env?: RngEnv,
): void {
  const s = seedval | 0;
  game.lcg_x = s % LCG_M; // JS % truncates toward zero, like C
  if (game.lcg_x < 0) {
    game.lcg_x = LCG_M + game.lcg_x;
  }
  // Once the seed is set, generate the Z'ZZZ word.
  const chars: string[] = [];
  for (let i = 0; i < 5; ++i) {
    chars.push(String.fromCharCode(65 + randrange(game, 26, env)));
  }
  chars[1] = "'"; // force second char to apostrophe
  game.zzword = chars.join('');
}
