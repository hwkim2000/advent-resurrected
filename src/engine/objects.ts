/*
 * Object and location bookkeeping (atloc/link chains) and the advent.h macros,
 * ported to TypeScript.
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
  BIRD,
  COND_ABOVE,
  COND_DEEP,
  COND_FLUID,
  COND_FOREST,
  COND_FORCED,
  COND_LIT,
  COND_OILY,
  EMERALD,
  AMBER,
  LAMP,
  LAMP_DARK,
  LOC_BUILDING,
  LOC_NOWHERE,
  NDWARVES,
  NLOCATIONS,
  NOBJECTS,
  NO_OBJECT,
  OIL,
  OIL_BOTTLE,
  BOTTLE,
  RUBY,
  SAPPH,
  WATER,
  WATER_BOTTLE,
  HERE as MOTION_HERE,
} from '../data/constants';
import { CONDITIONS, LOCATIONS } from '../data/dungeon';
import { TKEY, TRAVEL } from '../data/travel';
import { pspeak } from './io';
import type { IoCtx } from './io';
import type { Game } from './types';

/* ---- advent.h #defines ---- */

/** C: CARRIED (advent.h). Player is toting it. */
export const CARRIED = -1;
/** C: INVLIMIT. */
export const INVLIMIT = 7;
/** C: INTRANSITIVE. */
export const INTRANSITIVE = -1;
/** C: GAMELIMIT. Base limit of turns. */
export const GAMELIMIT = 330;
/** C: NOVICELIMIT. */
export const NOVICELIMIT = 1000;
/** C: WARNTIME. Late game starts at game.limit - this. */
export const WARNTIME = 30;
/** C: FLASHTIME. Turns from first warning till blinding flash. */
export const FLASHTIME = 50;
/** C: PANICTIME. Time left after closing. */
export const PANICTIME = 15;
/** C: BATTERYLIFE. Turn limit increment from batteries. */
export const BATTERYLIFE = 2500;
/** C: WORD_NOT_FOUND / WORD_EMPTY. */
export const WORD_NOT_FOUND = -1;
export const WORD_EMPTY = 0;
/** C: PIT_KILL_PROB. */
export const PIT_KILL_PROB = 35;
/** C: LINESIZE and TOKLEN. */
export const LINESIZE = 1024;
export const TOKLEN = 5;
/** C: PIRATE (the last dwarf). */
export const PIRATE = NDWARVES;
/** C: STATE_NOTFOUND, STATE_FOUND, STATE_IN_CAVITY. */
export const STATE_NOTFOUND = -1;
export const STATE_FOUND = 0;
export const STATE_IN_CAVITY = 1;
/** C: IS_FIXED, IS_FREE. */
export const IS_FIXED = -1;
export const IS_FREE = 0;

/* ---- Derived condition table (initialise) ---- */

/**
 * C: conditions[] after `initialise` has ORed in COND_FORCED for locations
 * whose first travel entry is HERE. Computed once; immutable derived data
 * that is never stored in the game state.
 */
export const CONDITIONS_EFFECTIVE: readonly number[] = (() => {
  const c = CONDITIONS.slice();
  for (let i = 1; i < NLOCATIONS; i++) {
    if (!(LOCATIONS[i]!.big === null || TKEY[i] === 0)) {
      const k = TKEY[i]!;
      if (TRAVEL[k]!.motion === MOTION_HERE) {
        c[i] = c[i]! | (1 << COND_FORCED);
      }
    }
  }
  return Object.freeze(c);
})();

/* ---- advent.h macros ---- */

/** C: PROP_IS_INVALID's companion PROP_STASHIFY(n). */
export function propStashify(n: number): number {
  return -1 - n;
}

/** C: OBJECT_IS_NOTFOUND(obj). */
export function objectIsNotFound(game: Game, obj: number): boolean {
  return game.objects[obj]!.prop === STATE_NOTFOUND;
}
/** C: OBJECT_IS_FOUND(obj). */
export function objectIsFound(game: Game, obj: number): boolean {
  return game.objects[obj]!.prop === STATE_FOUND;
}
/** C: OBJECT_SET_FOUND(obj). */
export function objectSetFound(game: Game, obj: number): void {
  game.objects[obj]!.prop = STATE_FOUND;
}
/** C: OBJECT_SET_NOT_FOUND(obj). */
export function objectSetNotFound(game: Game, obj: number): void {
  game.objects[obj]!.prop = STATE_NOTFOUND;
}
/** C: OBJECT_STASHIFY(obj, pval). */
export function objectStashify(game: Game, obj: number, pval: number): void {
  game.objects[obj]!.prop = propStashify(pval);
}
/** C: OBJECT_IS_STASHED(obj). */
export function objectIsStashed(game: Game, obj: number): boolean {
  return game.objects[obj]!.prop < STATE_NOTFOUND;
}
/** C: OBJECT_STATE_EQUALS(obj, pval). */
export function objectStateEquals(game: Game, obj: number, pval: number): boolean {
  const p = game.objects[obj]!.prop;
  return p === pval || p === propStashify(pval);
}

/** C: DESTROY(N). */
export function destroy(game: Game, obj: number): void {
  move(game, obj, LOC_NOWHERE);
}
/** C: TOTING(OBJ). */
export function toting(game: Game, obj: number): boolean {
  return game.objects[obj]!.place === CARRIED;
}
/** C: AT(OBJ). */
export function at(game: Game, obj: number): boolean {
  return game.objects[obj]!.place === game.loc || game.objects[obj]!.fixed === game.loc;
}
/** C: HERE(OBJ) (named isHere to avoid clashing with the HERE motion constant). */
export function isHere(game: Game, obj: number): boolean {
  return at(game, obj) || toting(game, obj);
}
/** C: CNDBIT(L, N). */
export function cndbit(loc: number, n: number): boolean {
  return tstbit(CONDITIONS_EFFECTIVE[loc]!, n);
}
/** C: LIQUID(). */
export function liquid(game: Game): number {
  const p = game.objects[BOTTLE]!.prop;
  return p === WATER_BOTTLE ? WATER : p === OIL_BOTTLE ? OIL : NO_OBJECT;
}
/** C: LIQLOC(LOC). */
export function liqloc(loc: number): number {
  return cndbit(loc, COND_FLUID) ? (cndbit(loc, COND_OILY) ? OIL : WATER) : NO_OBJECT;
}
/** C: FORCED(LOC). */
export function forced(loc: number): boolean {
  return cndbit(loc, COND_FORCED);
}
/** C: IS_DARK_HERE(). */
export function isDarkHere(game: Game): boolean {
  return (
    !cndbit(game.loc, COND_LIT) &&
    (game.objects[LAMP]!.prop === LAMP_DARK || !isHere(game, LAMP))
  );
}
/** C: GSTONE(OBJ). */
export function gstone(obj: number): boolean {
  return obj === EMERALD || obj === RUBY || obj === AMBER || obj === SAPPH;
}
/** C: FOREST(LOC). */
export function forest(loc: number): boolean {
  return cndbit(loc, COND_FOREST);
}
/** C: OUTSIDE(LOC). */
export function outside(loc: number): boolean {
  return cndbit(loc, COND_ABOVE) || forest(loc);
}
/** C: INSIDE(LOC). */
export function inside(loc: number): boolean {
  return !outside(loc) || loc === LOC_BUILDING;
}
/** C: INDEEP(LOC). */
export function indeep(loc: number): boolean {
  return cndbit(loc, COND_DEEP);
}

/* ---- misc.c object routines ---- */

/** C: juggle (misc.c). Move an object to the front of the chain at its loc. */
export function juggle(game: Game, object: number): void {
  const i = game.objects[object]!.place;
  const j = game.objects[object]!.fixed;
  move(game, object, i);
  move(game, object + NOBJECTS, j);
}

/** C: move (misc.c). Place any object anywhere by picking it up and dropping it. */
export function move(game: Game, object: number, where: number): void {
  let from: number;
  if (object >= NOBJECTS) {
    from = game.objects[object - NOBJECTS]!.fixed;
  } else {
    from = game.objects[object]!.place;
  }
  if (from !== LOC_NOWHERE && from !== CARRIED) {
    carry(game, object, from);
  }
  drop(game, object, where);
}

/** C: put (misc.c). Like move, but the object is stashed. */
export function put(game: Game, object: number, where: number, pval: number): void {
  move(game, object, where);
  objectStashify(game, object, pval);
}

/** C: carry (misc.c). Start toting an object, unlinking it from its location. */
export function carry(game: Game, object: number, where: number): void {
  if (object < NOBJECTS) {
    if (game.objects[object]!.place === CARRIED) {
      return;
    }
    game.objects[object]!.place = CARRIED;
    // The bird is weightless (cosmetic fix for the caged bird).
    if (object !== BIRD) {
      ++game.holdng;
    }
  }
  if (game.locs[where]!.atloc === object) {
    game.locs[where]!.atloc = game.link[object]!;
    return;
  }
  let temp = game.locs[where]!.atloc;
  while (game.link[temp] !== object) {
    temp = game.link[temp]!;
  }
  game.link[temp] = game.link[object]!;
}

/** C: drop (misc.c). Place an object at a location, prefixing the atloc list. */
export function drop(game: Game, object: number, where: number): void {
  if (object >= NOBJECTS) {
    game.objects[object - NOBJECTS]!.fixed = where;
  } else {
    if (game.objects[object]!.place === CARRIED) {
      if (object !== BIRD) {
        --game.holdng;
      }
    }
    game.objects[object]!.place = where;
  }
  if (where === LOC_NOWHERE || where === CARRIED) {
    return;
  }
  game.link[object] = game.locs[where]!.atloc;
  game.locs[where]!.atloc = object;
}

/**
 * C: atdwrf (misc.c). Index of the first dwarf at the location, 0 if none (or
 * dwarves not active), -1 if all dwarves are dead. Ignores the pirate.
 */
export function atdwrf(game: Game, where: number): number {
  let result = 0;
  if (game.dflag < 2) {
    return result;
  }
  result = -1;
  for (let i = 1; i <= NDWARVES - 1; i++) {
    if (game.dwarves[i]!.loc === where) {
      return i;
    }
    if (game.dwarves[i]!.loc !== 0) {
      result = 0;
    }
  }
  return result;
}

/** C: state_change (misc.c). Set an object's state and speak its change message. */
export function stateChange(ctx: IoCtx, obj: number, state: number): void {
  ctx.game.objects[obj]!.prop = state;
  pspeak(ctx, obj, 'change', true, state);
}

/** C: setbit (misc.c). Returns 2**bit. */
export function setbit(bit: number): number {
  return 1 << bit;
}

/** C: tstbit (misc.c). True if the bit is set in the mask. */
export function tstbit(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}
