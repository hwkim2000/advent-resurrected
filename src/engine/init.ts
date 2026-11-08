/*
 * Game initialisation, ported to TypeScript.
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

import {
  COND_HBASE,
  LOC_DEADEND13,
  LOC_MAZEEND12,
  LOC_NOWHERE,
  LOC_START,
  NDWARVES,
  NHINTS,
  NLOCATIONS,
  NOBJECTS,
} from '../data/constants';
import { DWARFLOCS, OBJECTS } from '../data/dungeon';
import { setSeed } from './rng';
import {
  CONDITIONS_EFFECTIVE,
  FLASHTIME,
  GAMELIMIT,
  WARNTIME,
  WORD_EMPTY,
  drop,
  objectSetFound,
  objectSetNotFound,
  setbit,
} from './objects';
import type { CommandT, Env, Game, GameOptions, GameState, Session, Word } from './types';

export { CONDITIONS_EFFECTIVE };

function emptyWord(): Word {
  return { raw: '', id: 0, type: 0 };
}

/** C: `struct game_t game = {...}` static initializer (init.c); zeroed otherwise. */
function initialGame(): Game {
  const locs: Game['locs'] = [];
  for (let i = 0; i < NLOCATIONS; i++) locs.push({ abbrev: 0, atloc: 0 });
  const dwarves: Game['dwarves'] = [];
  for (let i = 0; i <= NDWARVES; i++) dwarves.push({ seen: false, loc: 0, oldloc: 0 });
  const objects: Game['objects'] = [];
  for (let i = 0; i < NOBJECTS; i++) objects.push({ fixed: 0, prop: 0, place: 0 });
  const hints: Game['hints'] = [];
  for (let i = 0; i < NHINTS; i++) hints.push({ used: false, lc: 0 });
  const link: number[] = new Array<number>(NOBJECTS * 2).fill(0);
  return {
    lcg_x: 0,
    abbnum: 5,
    bonus: 0,
    chloc: LOC_MAZEEND12,
    chloc2: LOC_DEADEND13,
    clock1: WARNTIME,
    clock2: FLASHTIME,
    clshnt: false,
    closed: false,
    closng: false,
    lmwarn: false,
    novice: false,
    panic: false,
    wzdark: false,
    blooded: false,
    conds: 0,
    detail: 0,
    dflag: 0,
    dkill: 0,
    dtotal: 0,
    foobar: WORD_EMPTY,
    holdng: 0,
    igo: 0,
    iwest: 0,
    knfloc: 0,
    limit: GAMELIMIT,
    loc: LOC_START,
    newloc: LOC_START,
    numdie: 0,
    oldloc: 0,
    oldlc2: 0,
    oldobj: 0,
    saved: 0,
    tally: 0,
    thresh: 0,
    seenbigwords: false,
    trnluz: 0,
    turns: 0,
    zzword: '',
    locs,
    dwarves,
    objects,
    hints,
    link,
  };
}

/**
 * C: initialise (init.c). Builds the initial state for a seed. The seed
 * replaces `srand(time(NULL)); rand()`; the RNG draw order is unchanged.
 * The FORCED condition bits are not stored here (see CONDITIONS_EFFECTIVE).
 */
export function newGame(
  seed: number,
  options: GameOptions = {},
  env?: Pick<Env, 'rngTrace'>,
): GameState {
  const oldstyle = options.oldstyle === true;
  const game = initialGame();

  setSeed(game, seed, env);

  for (let i = 1; i <= NDWARVES; i++) {
    game.dwarves[i]!.loc = DWARFLOCS[i - 1]!;
  }

  for (let i = 1; i < NOBJECTS; i++) {
    game.objects[i]!.place = LOC_NOWHERE;
  }

  // (The COND_FORCED pass over conditions[] lives in CONDITIONS_EFFECTIVE.)

  /* Set up the atloc and link arrays. drop() prefaces new objects on the
   * lists, so run the loop backwards; two-placed objects are dropped first. */
  for (let i = NOBJECTS - 1; i >= 1; i--) {
    if (OBJECTS[i]!.fixd > 0) {
      drop(game, i + NOBJECTS, OBJECTS[i]!.fixd);
      drop(game, i, OBJECTS[i]!.plac);
    }
  }

  for (let k = NOBJECTS - 1; k >= 1; --k) {
    game.objects[k]!.fixed = OBJECTS[k]!.fixd;
    if (OBJECTS[k]!.plac !== 0 && OBJECTS[k]!.fixd <= 0) {
      drop(game, k, OBJECTS[k]!.plac);
    }
  }

  /* Treasure props start as STATE_NOTFOUND; non-treasures as STATE_FOUND. */
  for (let object = 1; object < NOBJECTS; object++) {
    if (OBJECTS[object]!.isTreasure) {
      ++game.tally;
      if (OBJECTS[object]!.inventory !== null) {
        objectSetNotFound(game, object);
      }
    } else {
      objectSetFound(game, object);
    }
  }
  game.conds = setbit(COND_HBASE);

  const cmd: CommandT = {
    part: 0,
    verb: 0,
    obj: 0,
    state: 0,
    word: [emptyWord(), emptyWord()],
  };
  const session: Session = {
    settings: { oldstyle, prompt: !oldstyle },
    cmd,
    pending: { k: 'novice' },
    status: 'running',
    exitReason: null,
    reportedLimit: game.limit,
    reportedScore: 0,
  };
  return { game, session };
}

/** Deep copy of a JSON-safe value (state, events). */
function cloneValue<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.map((x) => cloneValue(x)) as unknown as T;
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>)) {
      out[key] = cloneValue((v as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return v;
}

/** Deep copy of a GameState; `step` mutates only the copy (design D2). */
export function cloneState(state: GameState): GameState {
  return cloneValue(state);
}

/** Dev-mode helper: recursively freeze a value to catch accidental mutation. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
