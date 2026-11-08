/*
 * Player movement: the travel table interpreter.
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
  BACK,
  BAD_DIRECTION,
  BEAR,
  BEAR_DEAD,
  BRIDGE_WRECKED,
  CANT_APPLY,
  CAVE,
  CHASM,
  COND_NOBACK,
  CRAWL,
  DOWN,
  EAST,
  EMERALD,
  FOLLOW_STREAM,
  FORGOT_PATH,
  FORWARD,
  HERE as MOTION_HERE,
  INSIDE,
  LEFT,
  LOC_ALCOVE,
  LOC_GRATE,
  LOC_PLOVER,
  LOOK,
  MUST_DROP,
  NE,
  NEED_DETAIL,
  NO_INOUT_HERE,
  NO_MORE_DETAIL,
  NOBJECTS,
  NORTH,
  NOT_CONNECTED,
  NOTHING_HAPPENS,
  NUL,
  NW,
  OUTSIDE as MOTION_OUTSIDE,
  PLUGH,
  RIGHT,
  SE,
  SOUTH,
  SW,
  TROLL,
  TROLL2,
  TROLL_GONE,
  TROLL_PAIDONCE,
  TROLL_UNPAID,
  TWIST_TURN,
  UNSURE_FACING,
  UP,
  WEST,
  WHICH_WAY,
  XYZZY,
} from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import { TKEY, TRAVEL } from '../data/travel';
import type { TravelOp } from '../data/travel';
import { pspeak, rspeak } from './io';
import type { IoCtx } from './io';
import {
  at,
  cndbit,
  destroy,
  drop,
  forced,
  IS_FIXED,
  IS_FREE,
  juggle,
  move,
  outside,
  stateChange,
  toting,
} from './objects';
import { pct } from './rng';
import { EngineBug } from './types';
import type { Env } from './types';

/* C: enum condtype_t and enum desttype_t (advent.h / dungeon.h). */
const COND_GOTO = 0;
const COND_PCT = 1;
const COND_WITH = 3;
const COND_NOT = 4;
const DEST_GOTO = 0;
const DEST_SPEAK = 2;

/** One entry of the travel table (bounds-checked). */
function tr(i: number): TravelOp {
  const t = TRAVEL[i];
  if (t === undefined) throw new EngineBug(`travel index ${i} out of range`);
  return t;
}

/**
 * C: traveleq (main.c). Are two travel entries equal for purposes of skip
 * after a failed condition?
 */
export function traveleq(a: number, b: number): boolean {
  const ta = tr(a);
  const tb = tr(b);
  return (
    ta.condtype === tb.condtype &&
    ta.condarg1 === tb.condarg1 &&
    ta.condarg2 === tb.condarg2 &&
    ta.desttype === tb.desttype &&
    ta.destval === tb.destval
  );
}

/** C: the "skip to next non-matching destination" loop (main.c). */
function skipFailed(travelEntry: number): number {
  let teTmp = travelEntry;
  do {
    if (tr(teTmp).stop) {
      // C: BUG(CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION)
      throw new EngineBug('CONDITIONAL_TRAVEL_ENTRY_WITH_NO_ALTERATION');
    }
    ++teTmp;
  } while (traveleq(travelEntry, teTmp));
  return teTmp;
}

/**
 * C: playermove (main.c). Given the current location in game.loc and a motion
 * verb number, put the new location in game.newloc. The current loc is saved
 * in game.oldloc in case he wants to retreat, and the old oldloc is saved in
 * game.oldlc2 in case he dies.
 *
 * `croak` is the main loop's C: croak (called when the bear collapses the
 * bridge). It blocks on the reincarnation question by storing a Pending tag,
 * so playermove simply returns after calling it.
 */
export function playermove(
  ctx: IoCtx,
  motionIn: number,
  croak: () => void,
  env?: Pick<Env, 'rngTrace'>,
): void {
  const game = ctx.game;
  let motion = motionIn;
  let travelEntry = TKEY[game.loc] ?? 0;
  game.newloc = game.loc;
  if (travelEntry === 0) {
    // C: BUG(LOCATION_HAS_NO_TRAVEL_ENTRIES)
    throw new EngineBug('LOCATION_HAS_NO_TRAVEL_ENTRIES');
  }
  if (motion === NUL) {
    return;
  } else if (motion === BACK) {
    /* Handle "go back". Look for verb which goes from game.loc to
     * game.oldloc, or to game.oldlc2 if game.oldloc has forced-motion.
     * te_tmp saves entry -> forced loc -> previous loc. */
    motion = game.oldloc;
    if (forced(motion)) {
      motion = game.oldlc2;
    }
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    if (cndbit(game.loc, COND_NOBACK)) {
      rspeak(ctx, TWIST_TURN);
      return;
    }
    if (motion === game.loc) {
      rspeak(ctx, FORGOT_PATH);
      return;
    }

    let teTmp = 0;
    for (;;) {
      const desttype = tr(travelEntry).desttype;
      const scratchloc = tr(travelEntry).destval;
      if (desttype !== DEST_GOTO || scratchloc !== motion) {
        if (desttype === DEST_GOTO) {
          if (forced(scratchloc) && tr(TKEY[scratchloc] ?? 0).destval === motion) {
            teTmp = travelEntry;
          }
        }
        if (!tr(travelEntry).stop) {
          ++travelEntry; /* go to next travel entry for this location */
          continue;
        }
        /* we've reached the end of travel entries for game.loc */
        travelEntry = teTmp;
        if (travelEntry === 0) {
          rspeak(ctx, NOT_CONNECTED);
          return;
        }
      }

      motion = tr(travelEntry).motion;
      travelEntry = TKEY[game.loc] ?? 0;
      break; /* fall through to ordinary travel */
    }
  } else if (motion === LOOK) {
    /* Look. Can't give more detail. Pretend it wasn't dark (though it may
     * now be dark) so he won't fall into a pit while staring into the gloom. */
    if (game.detail < 3) {
      rspeak(ctx, NO_MORE_DETAIL);
    }
    ++game.detail;
    game.wzdark = false;
    game.locs[game.loc]!.abbrev = 0;
    return;
  } else if (motion === CAVE) {
    /* Cave. Different messages depending on whether above ground. */
    rspeak(
      ctx,
      outside(game.loc) && game.loc !== LOC_GRATE ? FOLLOW_STREAM : NEED_DETAIL,
    );
    return;
  } else {
    /* none of the specials */
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
  }

  /* Look for a way to fulfil the motion verb passed in - travelEntry indexes
   * the beginning of the motion entries for here (game.loc). */
  for (;;) {
    if (tr(travelEntry).motion === MOTION_HERE || tr(travelEntry).motion === motion) {
      break;
    }
    if (tr(travelEntry).stop) {
      /* Couldn't find an entry matching the motion word passed in. Various
       * messages depending on word given. */
      switch (motion) {
        case EAST:
        case WEST:
        case SOUTH:
        case NORTH:
        case NE:
        case NW:
        case SW:
        case SE:
        case UP:
        case DOWN:
          rspeak(ctx, BAD_DIRECTION);
          break;
        case FORWARD:
        case LEFT:
        case RIGHT:
          rspeak(ctx, UNSURE_FACING);
          break;
        case MOTION_OUTSIDE:
        case INSIDE:
          rspeak(ctx, NO_INOUT_HERE);
          break;
        case XYZZY:
        case PLUGH:
          rspeak(ctx, NOTHING_HAPPENS);
          break;
        case CRAWL:
          rspeak(ctx, WHICH_WAY);
          break;
        default:
          rspeak(ctx, CANT_APPLY);
      }
      return;
    }
    ++travelEntry;
  }

  /* (ESR) We've found a destination that goes with the motion verb. Next we
   * need to check any conditional(s) on this destination, and possibly on
   * following entries. */
  for (;;) {
    /* L12 loop */
    for (;;) {
      const { condtype, condarg1, condarg2 } = tr(travelEntry);
      if (condtype < COND_NOT) {
        /* YAML N and [pct N] conditionals */
        if (condtype === COND_GOTO || condtype === COND_PCT) {
          if (condarg1 === 0 || pct(game, condarg1, env)) {
            break;
          }
          /* else fall through */
        } else if (
          /* YAML [with OBJ] clause */
          toting(game, condarg1) ||
          (condtype === COND_WITH && at(game, condarg1))
        ) {
          break;
        }
        /* else fall through to check [not OBJ STATE] */
      } else if (game.objects[condarg1]!.prop !== condarg2) {
        break;
      }

      /* We arrive here on conditional failure. Skip to next non-matching
       * destination */
      travelEntry = skipFailed(travelEntry);
    }

    /* Found an eligible rule, now execute it */
    const desttype = tr(travelEntry).desttype;
    game.newloc = tr(travelEntry).destval;
    if (desttype === DEST_GOTO) {
      return;
    }

    if (desttype === DEST_SPEAK) {
      /* Execute a speak rule */
      rspeak(ctx, game.newloc);
      game.newloc = game.loc;
      return;
    }

    switch (game.newloc) {
      case 1:
        /* Special travel 1. Plover-alcove passage. Can carry only emerald.
         * Note: travel table must include "useless" entries going through
         * passage, which can never be used for actual motion, but can be
         * spotted by "go back". */
        game.newloc = game.loc === LOC_PLOVER ? LOC_ALCOVE : LOC_PLOVER;
        if (game.holdng > 1 || (game.holdng === 1 && !toting(game, EMERALD))) {
          game.newloc = game.loc;
          rspeak(ctx, MUST_DROP);
        }
        return;
      case 2:
        /* Special travel 2. Plover transport. Drop the emerald (only use
         * special travel if toting it), so he's forced to use the
         * plover-passage to get it out. Having dropped it, go back and
         * pretend he wasn't carrying it after all. */
        drop(game, EMERALD, game.loc);
        travelEntry = skipFailed(travelEntry);
        continue; /* goto L12 */
      case 3: {
        /* Special travel 3. Troll bridge. Must be done only as special
         * motion so that dwarves won't wander across and encounter the bear.
         * (They won't follow the player there because that region is
         * forbidden to the pirate.) If game.prop[TROLL]=TROLL_PAIDONCE,
         * he's crossed since paying, so step out and block him. (standard
         * travel entries check for game.prop[TROLL]=TROLL_UNPAID.) Special
         * stuff for bear. */
        const troll = game.objects[TROLL]!;
        if (troll.prop === TROLL_PAIDONCE) {
          pspeak(ctx, TROLL, 'look', true, TROLL_PAIDONCE);
          troll.prop = TROLL_UNPAID;
          destroy(game, TROLL2);
          move(game, TROLL2 + NOBJECTS, IS_FREE);
          move(game, TROLL, OBJECTS[TROLL]!.plac);
          move(game, TROLL + NOBJECTS, OBJECTS[TROLL]!.fixd);
          juggle(game, CHASM);
          game.newloc = game.loc;
          return;
        }
        game.newloc = OBJECTS[TROLL]!.plac + OBJECTS[TROLL]!.fixd - game.loc;
        if (troll.prop === TROLL_UNPAID) {
          troll.prop = TROLL_PAIDONCE;
        }
        if (!toting(game, BEAR)) {
          return;
        }
        stateChange(ctx, CHASM, BRIDGE_WRECKED);
        troll.prop = TROLL_GONE;
        drop(game, BEAR, game.newloc);
        game.objects[BEAR]!.fixed = IS_FIXED;
        game.objects[BEAR]!.prop = BEAR_DEAD;
        game.oldlc2 = game.newloc;
        croak();
        return;
      }
      default:
        // C: BUG(SPECIAL_TRAVEL_500_GT_L_GT_300_EXCEEDS_GOTO_LIST)
        throw new EngineBug('SPECIAL_TRAVEL_500_GT_L_GT_300_EXCEEDS_GOTO_LIST');
    }
  }
}
