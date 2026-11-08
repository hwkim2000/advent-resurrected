/*
 * Dwarves and the pirate.
 *
 * Ported from Open Adventure (https://gitlab.com/esr/open-adventure), main.c.
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
  AXE,
  CHEST,
  COND_NOARRR,
  COND_NOBACK,
  DWARF_PACK,
  DWARF_RAN,
  DWARF_SINGLE,
  EMERALD,
  GETS_YOU,
  KNIFE_THROWN,
  LAMP,
  LAMP_BRIGHT,
  LOC_NOWHERE,
  LOC_NUGGET,
  MESSAG,
  MISSES_YOU,
  MULTIPLE_HITS,
  NDWARVES,
  NOBJECTS,
  NONE_HIT,
  ONE_HIT,
  PIRATE_POUNCES,
  PIRATE_RUSTLES,
  PIRATE_SPOTTED,
  PYRAMID,
  THROWN_KNIVES,
} from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import { TKEY, TRAVEL } from '../data/travel';
import { rspeak } from './io';
import type { IoCtx } from './io';
import {
  carry,
  cndbit,
  drop,
  forced,
  indeep,
  IS_FREE,
  isHere,
  move,
  objectIsNotFound,
  PIRATE,
  toting,
  at,
} from './objects';
import { pct, randrange } from './rng';
import { EngineBug } from './types';
import type { Env } from './types';

type RngEnv = Pick<Env, 'rngTrace'>;

/** C: DALTLC (advent.h). Alternate dwarf location. */
const DALTLC = LOC_NUGGET;
/** C: sizeof(tk)/sizeof(tk[0]) in dwarfmove. */
const TK_SIZE = 21;

/**
 * C: spotted_by_pirate (main.c). The pirate has spotted the player; returns
 * true (the pirate is not a "threatening dwarf") after possibly moving the
 * chest and robbing the player.
 */
export function spottedByPirate(ctx: IoCtx, i: number, env?: RngEnv): boolean {
  const game = ctx.game;
  if (i !== PIRATE) {
    return false;
  }

  /* The pirate's spotted him. Pirate leaves him alone once we've found chest.
   * K counts if a treasure is here. If not, and tally=1 for an unseen chest,
   * let the pirate be spotted. */
  if (game.loc === game.chloc || !objectIsNotFound(game, CHEST)) {
    return true;
  }
  let snarfed = 0;
  let movechest = false;
  let robplayer = false;
  for (let treasure = 1; treasure < NOBJECTS; treasure++) {
    if (!OBJECTS[treasure]!.isTreasure) {
      continue;
    }
    /* Pirate won't take pyramid from plover room or dark room (too easy!). */
    if (
      treasure === PYRAMID &&
      (game.loc === OBJECTS[PYRAMID]!.plac || game.loc === OBJECTS[EMERALD]!.plac)
    ) {
      continue;
    }
    if (toting(game, treasure) || isHere(game, treasure)) {
      ++snarfed;
    }
    if (toting(game, treasure)) {
      movechest = true;
      robplayer = true;
    }
  }
  /* Force chest placement before player finds last treasure */
  if (
    game.tally === 1 &&
    snarfed === 0 &&
    game.objects[CHEST]!.place === LOC_NOWHERE &&
    isHere(game, LAMP) &&
    game.objects[LAMP]!.prop === LAMP_BRIGHT
  ) {
    rspeak(ctx, PIRATE_SPOTTED);
    movechest = true;
  }
  /* Do things in this order (chest move before robbery) so chest is listed
   * last at the maze location. */
  const pirate = game.dwarves[PIRATE]!;
  if (movechest) {
    move(game, CHEST, game.chloc);
    move(game, MESSAG, game.chloc2);
    pirate.loc = game.chloc;
    pirate.oldloc = game.chloc;
    pirate.seen = false;
  } else {
    /* You might get a hint of the pirate's presence even if the chest
     * doesn't move... */
    if (pirate.oldloc !== pirate.loc && pct(game, 20, env)) {
      rspeak(ctx, PIRATE_RUSTLES);
    }
  }
  if (robplayer) {
    rspeak(ctx, PIRATE_POUNCES);
    for (let treasure = 1; treasure < NOBJECTS; treasure++) {
      if (!OBJECTS[treasure]!.isTreasure) {
        continue;
      }
      if (
        !(
          treasure === PYRAMID &&
          (game.loc === OBJECTS[PYRAMID]!.plac || game.loc === OBJECTS[EMERALD]!.plac)
        )
      ) {
        if (at(game, treasure) && game.objects[treasure]!.fixed === IS_FREE) {
          carry(game, treasure, game.loc);
        }
        if (toting(game, treasure)) {
          drop(game, treasure, game.chloc);
        }
      }
    }
  }

  return true;
}

/**
 * C: dwarfmove (main.c). Dwarves move. Returns true if the player survives,
 * false if he dies (the caller then calls croak).
 */
export function dwarfmove(ctx: IoCtx, env?: RngEnv): boolean {
  const game = ctx.game;

  /* First off, don't let the dwarves follow him into a pit or a wall.
   * Activate the whole mess the first time he gets as far as the Hall of
   * Mists (what INDEEP() tests). If game.newloc is forbidden to pirate (in
   * particular, if it's beyond the troll bridge), bypass dwarf stuff. */
  if (
    game.loc === LOC_NOWHERE ||
    forced(game.loc) ||
    cndbit(game.newloc, COND_NOARRR)
  ) {
    return true;
  }

  /* Dwarf activity level ratchets up */
  if (game.dflag === 0) {
    if (indeep(game.loc)) {
      game.dflag = 1;
    }
    return true;
  }

  /* When we encounter the first dwarf, we kill 0, 1, or 2 of the 5 dwarves.
   * If any of the survivors is at game.loc, replace him with the alternate. */
  if (game.dflag === 1) {
    if (
      !indeep(game.loc) ||
      (pct(game, 95, env) && (!cndbit(game.loc, COND_NOBACK) || pct(game, 85, env)))
    ) {
      return true;
    }
    game.dflag = 2;
    for (let i = 1; i <= 2; i++) {
      const j = 1 + randrange(game, NDWARVES - 1, env);
      if (pct(game, 50, env)) {
        game.dwarves[j]!.loc = 0;
      }
    }

    /* Alternate initial loc for dwarf, in case one of them starts out on top
     * of the adventurer. */
    for (let i = 1; i <= NDWARVES - 1; i++) {
      const d = game.dwarves[i]!;
      if (d.loc === game.loc) {
        d.loc = DALTLC;
      }
      d.oldloc = d.loc;
    }
    rspeak(ctx, DWARF_RAN);
    drop(game, AXE, game.loc);
    return true;
  }

  /* Things are in full swing. Move each dwarf at random, except if he's seen
   * us he sticks with us. Dwarves stay deep inside. If wandering at random,
   * they don't back up unless there's no alternative. If they don't have to
   * move, they attack. And, of course, dead dwarves don't do much of
   * anything. */
  game.dtotal = 0;
  let attack = 0;
  let stick = 0;
  const tk: number[] = new Array<number>(TK_SIZE).fill(0);
  for (let i = 1; i <= NDWARVES; i++) {
    const dwarf = game.dwarves[i]!;
    if (dwarf.loc === 0) {
      continue;
    }
    /* Fill tk array with all the places this dwarf might go. */
    let j = 1;
    let kk = TKEY[dwarf.loc] ?? 0;
    if (kk !== 0) {
      do {
        const t = TRAVEL[kk];
        if (t === undefined) throw new EngineBug(`travel index ${kk} out of range`);
        game.newloc = t.destval;
        /* Have we avoided a dwarf encounter? (C: `continue` in a do-while
         * still evaluates the loop condition.) */
        const skip =
          t.desttype !== 0 ||
          !indeep(game.newloc) ||
          game.newloc === dwarf.oldloc ||
          (j > 1 && game.newloc === tk[j - 1]) ||
          j >= TK_SIZE - 1 ||
          game.newloc === dwarf.loc ||
          forced(game.newloc) ||
          (i === PIRATE && cndbit(game.newloc, COND_NOARRR)) ||
          t.nodwarves;
        if (!skip) {
          tk[j++] = game.newloc;
        }
      } while (!TRAVEL[kk++]!.stop);
    }
    tk[j] = dwarf.oldloc;
    if (j >= 2) {
      --j;
    }
    j = 1 + randrange(game, j, env);
    dwarf.oldloc = dwarf.loc;
    dwarf.loc = tk[j]!;
    dwarf.seen =
      (dwarf.seen && indeep(game.loc)) ||
      dwarf.loc === game.loc ||
      dwarf.oldloc === game.loc;
    if (!dwarf.seen) {
      continue;
    }
    dwarf.loc = game.loc;
    if (spottedByPirate(ctx, i, env)) {
      continue;
    }
    /* This threatening little dwarf is in the room with him! */
    ++game.dtotal;
    if (dwarf.oldloc === dwarf.loc) {
      ++attack;
      if (game.knfloc >= LOC_NOWHERE) {
        game.knfloc = game.loc;
      }
      if (randrange(game, 1000, env) < 95 * (game.dflag - 2)) {
        ++stick;
      }
    }
  }

  /* Now we know what's happening. Let's tell the poor sucker about it. */
  if (game.dtotal === 0) {
    return true;
  }
  rspeak(ctx, game.dtotal === 1 ? DWARF_SINGLE : DWARF_PACK, game.dtotal);
  if (attack === 0) {
    return true;
  }
  if (game.dflag === 2) {
    game.dflag = 3;
  }
  if (attack > 1) {
    rspeak(ctx, THROWN_KNIVES, attack);
    rspeak(ctx, stick > 1 ? MULTIPLE_HITS : stick === 1 ? ONE_HIT : NONE_HIT, stick);
  } else {
    rspeak(ctx, KNIFE_THROWN);
    rspeak(ctx, stick ? GETS_YOU : MISSES_YOU);
  }
  if (stick === 0) {
    return true;
  }
  game.oldlc2 = game.loc;
  return false;
}
