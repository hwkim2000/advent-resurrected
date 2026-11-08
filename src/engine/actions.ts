/*
 * The action dispatcher and the non-blocking action handlers, ported to
 * TypeScript from Open Adventure's actions.c.
 *
 * Ported from Open Adventure (https://gitlab.com/esr/open-adventure).
 * SPDX-FileCopyrightText: (C) 1977, 2005 Will Crowther and Don Woods
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
 *
 * Handlers that block on input or end the game (attack, quit, read, bigwords,
 * blast, suspend, resume) live in actions-special.ts and are imported here.
 */

import {
  AMBER,
  AMBER_IN_ROCK,
  AM_GAME,
  ALREADY_CARRYING,
  ALREADY_LOCKED,
  ALREADY_UNLOCKED,
  ALL_SILENT,
  ARENT_CARRYING,
  ATTACK,
  AXE,
  AXE_HERE,
  AXE_LOST,
  BATTERY,
  BEAR,
  BEAR_BLOCKS,
  BEAR_CHAINED,
  BEAR_DEAD,
  BEYOND_POWER,
  BIRD,
  BIRD_ATTACKS,
  BIRD_BURNT,
  BIRD_CAGED,
  BIRD_CRAP,
  BIRD_DEVOURED,
  BIRD_ENDSTATE,
  BIRD_EVADES,
  BIRD_FOREST_UNCAGED,
  BIRD_PINING,
  BIRD_UNCAGED,
  BLAST,
  BLOOD,
  BOTTLE,
  BOTTLE_FULL,
  BREAK,
  BRIDGED,
  BRIEF,
  BRIEF_CONFIRM,
  CAGE,
  CAGE_FLY,
  CANNOT_CARRY,
  CANNOT_UNLOCK,
  CANT_POUR,
  CARRY,
  CARRY_LIMIT,
  CAVITY,
  CAVITY_EMPTY,
  CAVITY_FULL,
  CHAIN,
  CHAIN_FIXED,
  CHAIN_HEAP,
  CHAIN_LOCKED,
  CHAIN_UNLOCKED,
  CHASM,
  CLAM,
  CLAM_OPENER,
  COINS,
  CONTENTED_BEAR,
  DEEP_ROOTS,
  DOOR,
  DOOR_RUSTED,
  DOOR_UNRUSTED,
  DONT_UNDERSTAND,
  DOUGHNUT_HOLES,
  DRAGON,
  DRAGON_BARS,
  DRAGON_BLOODLESS,
  DRAGON_SCALES,
  DRINK,
  DROP,
  DROP_CLAM,
  DROP_OYSTER,
  DWARF,
  DWARF_DODGES,
  DWARF_SMOKE,
  EAT,
  EMERALD,
  EMPTY_BOTTLE,
  EXIT_CLOSED,
  EXTINGUISH,
  FEE,
  FEED,
  FEW_DROPS,
  FIE,
  FILL,
  FILL_INVALID,
  FIND,
  FISSURE,
  FLAP_ARMS,
  FLY,
  FOE,
  FOO,
  FOOD,
  FRESH_BATTERIES,
  FUM,
  FULL_URN,
  GEM_FITS,
  GO,
  GRATE,
  GRATE_CLOSED,
  GRATE_OPEN,
  GROUND_WET,
  HAND_PASSTHROUGH,
  HUH_MAN,
  INVENTORY,
  JADE,
  KEYS,
  KILLED_DWARF,
  KNIFE,
  KNIVES_VANISH,
  LAMP,
  LAMP_BRIGHT,
  LAMP_DARK,
  LAMP_OUT,
  LIGHT,
  LISTEN,
  LOCK,
  LOC_CLIFF,
  LOC_CULDESAC,
  LOC_LEDGE,
  LOC_NOWHERE,
  LOC_RESBOTTOM,
  LOST_APPETITE,
  MESSAG,
  MIRROR,
  MIRROR_BROKEN,
  NECKLACE_FLY,
  NEEDED_NEARBY,
  NDWARVES,
  NOBJECTS,
  NOTHING,
  NOTHING_EDIBLE,
  NOTHING_HAPPENS,
  NOTHING_LOCKED,
  NOT_BRIGHT,
  NOW_HOLDING,
  NO_CARRY,
  NO_CONTAINER,
  NO_KEYS,
  NO_LIQUID,
  NO_LOCK,
  NO_LOCKSITE,
  NO_MESSAGE,
  NO_OBJECT,
  NO_SEE,
  NUMERIC_REQUIRED,
  OGRE,
  OGRE_DODGE,
  OGRE_FULL,
  OIL,
  OIL_BOTTLE,
  OIL_URN,
  OK_MAN,
  OKEY_DOKEY,
  OYSTER,
  OYSTER_OPENER,
  OYSTER_OPENS,
  PART,
  PEARL,
  PEARL_FALLS,
  PECULIAR_NOTHING,
  PILLOW,
  PITCH_DARK,
  PLANT,
  PLANT2,
  PLANT_THIRSTY,
  PLOVER,
  PLUGH,
  POUR,
  PROD_DWARF,
  QUIT,
  READ,
  REALLY_MAD,
  REMOVE_MESSAGE,
  RESER,
  RESUME,
  RIDICULOUS_ATTEMPT,
  ROD,
  ROD2,
  RUB,
  RUG,
  RUG_FLOOR,
  RUG_GOES,
  RUG_HOVER,
  RUG_HOVERS,
  RUG_NOTHING1,
  RUG_NOTHING2,
  RUG_RETURNS,
  RUG_RISES,
  RUG_SETTLES,
  RUG_WIGGLES,
  RUBY,
  RUSTY_DOOR,
  SAPPH,
  SAVE,
  SAY,
  SCORE,
  SEED,
  SHAKING_LEAVES,
  SHATTER_VASE,
  SIGN,
  SILENT,
  SITTING_BEAR,
  SNAKE,
  SNAKE_CHASED,
  STEPS,
  STILL_LOCKED,
  TAME,
  TAME_BEAR,
  THANKS_DELICIOUS,
  THROW,
  TOO_FAR,
  TRIDENT,
  TROLL,
  TROLL2,
  TROLL_GONE,
  TROLL_RETURNS,
  TROLL_SATISFIED,
  TROLL_VICES,
  UNBRIDGED,
  UNLOCK,
  UNTAMED_BEAR,
  URN,
  URN_DARK,
  URN_EMPTY,
  URN_GENIES,
  URN_LIT,
  URN_NOBUDGE,
  URN_NOPOUR,
  VASE,
  VASE_BROKEN,
  VASE_DROPPED,
  VASE_WHOLE,
  VEND,
  VOLCANO,
  WASTE,
  WATER,
  WATERS_PARTED,
  WATERS_UNPARTED,
  WATER_BOTTLE,
  WATER_URN,
  WAKE,
  WAVE,
  YOU_HAVEIT,
  YOU_JOKING,
  WHAT_DO,
  FREE_FLY,
  XYZZY,
} from '../data/constants';
import { ACTIONS, ARBITRARY_MESSAGES, LOCATIONS, OBJECTS } from '../data/dungeon';
import { pspeak, rspeak, speak, sspeak } from './io';
import type { IoCtx } from './io';
import {
  CARRIED,
  INTRANSITIVE,
  INVLIMIT,
  IS_FIXED,
  IS_FREE,
  PANICTIME,
  STATE_IN_CAVITY,
  WORD_EMPTY,
  WORD_NOT_FOUND,
  at,
  atdwrf,
  carry,
  destroy,
  drop,
  forest,
  gstone,
  isDarkHere,
  isHere,
  juggle,
  liqloc,
  liquid,
  move,
  objectIsFound,
  objectIsNotFound,
  objectIsStashed,
  objectSetFound,
  objectStateEquals,
  stateChange,
  toting,
} from './objects';
import { randrange, setSeed } from './rng';
import { scoreGame } from './score';
import {
  GO_CHECKHINT,
  GO_CLEAROBJ,
  GO_DWARFWAKE,
  GO_MOVE,
  GO_TERMINATE,
  GO_TOP,
  GO_UNKNOWN,
  GO_WORD2,
  attack,
  bigwords,
  blast,
  quit,
  read,
  resume,
  suspend,
} from './actions-special';
import type { ActionResult, PhaseCode } from './actions-special';
import { EngineBug } from './types';
import type { CommandT, Env, Session } from './types';

type RngEnv = Pick<Env, 'rngTrace'>;

/* C: enum speechpart, enum word_type_t (advent.h). */
const PART_UNKNOWN = 0;
const PART_INTRANSITIVE = 1;
const PART_TRANSITIVE = 2;
const WORD_MOTION = 1;
const WORD_ACTION = 3;

/** C: actions[verb].message. */
function verbMessage(verb: number): string | null {
  return ACTIONS[verb]?.message ?? null;
}

/**
 * C: strtol(arg, NULL, 10) / atol(arg), truncated to the int32 that the C
 * callers store it in. Leading whitespace, optional sign, decimal digits;
 * anything else yields 0. Saturates at the 64-bit long range like glibc.
 */
function cStrtol(arg: string): number {
  const m = /^[ \t\n\v\f\r]*([+-]?)(\d+)/.exec(arg);
  if (m === null) {
    return 0;
  }
  let v = BigInt(m[2]!);
  if (m[1] === '-') {
    v = -v;
  }
  const max = (1n << 63n) - 1n;
  const min = -(1n << 63n);
  if (v > max) v = max;
  if (v < min) v = min;
  return Number(BigInt.asIntN(32, v));
}

/** C: vbreak (actions.c). Only works for mirror in repository and the vase. */
function vbreak(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  switch (obj) {
    case MIRROR:
      if (game.closed) {
        stateChange(ctx, MIRROR, MIRROR_BROKEN);
        return GO_DWARFWAKE;
      }
      rspeak(ctx, TOO_FAR);
      break;
    case VASE:
      if (game.objects[VASE]!.prop === VASE_WHOLE) {
        if (toting(game, VASE)) {
          drop(game, VASE, game.loc);
        }
        stateChange(ctx, VASE, VASE_BROKEN);
        game.objects[VASE]!.fixed = IS_FIXED;
      } else {
        /* C: FALLTHRU to default */
        speak(ctx, verbMessage(verb));
      }
      break;
    default:
      speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/** C: brief (actions.c). Suppress full descriptions after first time. */
function brief(ctx: IoCtx): PhaseCode {
  ctx.game.abbnum = 10000;
  ctx.game.detail = 3;
  rspeak(ctx, BRIEF_CONFIRM);
  return GO_CLEAROBJ;
}

/**
 * C: vcarry (actions.c). Carry an object. Special cases for bird and cage,
 * liquids, and various side effects.
 */
function vcarry(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === INTRANSITIVE) {
    /* Carry, no object given yet. OK if only one object present. */
    if (
      game.locs[game.loc]!.atloc === NO_OBJECT ||
      game.link[game.locs[game.loc]!.atloc] !== 0 ||
      atdwrf(game, game.loc) > 0
    ) {
      return GO_UNKNOWN;
    }
    obj = game.locs[game.loc]!.atloc;
  }

  if (toting(game, obj)) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }

  if (obj === MESSAG) {
    rspeak(ctx, REMOVE_MESSAGE);
    destroy(game, MESSAG);
    return GO_CLEAROBJ;
  }

  if (game.objects[obj]!.fixed !== IS_FREE) {
    switch (obj) {
      case PLANT:
        rspeak(
          ctx,
          game.objects[PLANT]!.prop === PLANT_THIRSTY || objectIsStashed(game, PLANT)
            ? DEEP_ROOTS
            : YOU_JOKING,
        );
        break;
      case BEAR:
        rspeak(ctx, game.objects[BEAR]!.prop === SITTING_BEAR ? BEAR_CHAINED : YOU_JOKING);
        break;
      case CHAIN:
        rspeak(ctx, game.objects[BEAR]!.prop !== UNTAMED_BEAR ? STILL_LOCKED : YOU_JOKING);
        break;
      case RUG:
        rspeak(ctx, game.objects[RUG]!.prop === RUG_HOVER ? RUG_HOVERS : YOU_JOKING);
        break;
      case URN:
        rspeak(ctx, URN_NOBUDGE);
        break;
      case CAVITY:
        rspeak(ctx, DOUGHNUT_HOLES);
        break;
      case BLOOD:
        rspeak(ctx, FEW_DROPS);
        break;
      case SIGN:
        rspeak(ctx, HAND_PASSTHROUGH);
        break;
      default:
        rspeak(ctx, YOU_JOKING);
    }
    return GO_CLEAROBJ;
  }

  if (obj === WATER || obj === OIL) {
    if (!isHere(game, BOTTLE) || liquid(game) !== obj) {
      if (!toting(game, BOTTLE)) {
        rspeak(ctx, NO_CONTAINER);
        return GO_CLEAROBJ;
      }
      if (game.objects[BOTTLE]!.prop === EMPTY_BOTTLE) {
        return fill(ctx, verb, BOTTLE);
      }
      rspeak(ctx, BOTTLE_FULL);
      return GO_CLEAROBJ;
    }
    obj = BOTTLE;
  }

  if (game.holdng >= INVLIMIT) {
    rspeak(ctx, CARRY_LIMIT);
    return GO_CLEAROBJ;
  }

  if (
    obj === BIRD &&
    game.objects[BIRD]!.prop !== BIRD_CAGED &&
    !objectIsStashed(game, BIRD)
  ) {
    if (game.objects[BIRD]!.prop === BIRD_FOREST_UNCAGED) {
      destroy(game, BIRD);
      rspeak(ctx, BIRD_CRAP);
      return GO_CLEAROBJ;
    }
    if (!toting(game, CAGE)) {
      rspeak(ctx, CANNOT_CARRY);
      return GO_CLEAROBJ;
    }
    if (toting(game, ROD)) {
      rspeak(ctx, BIRD_EVADES);
      return GO_CLEAROBJ;
    }
    game.objects[BIRD]!.prop = BIRD_CAGED;
  }
  if ((obj === BIRD || obj === CAGE) && objectStateEquals(game, BIRD, BIRD_CAGED)) {
    /* expression maps BIRD to CAGE and CAGE to BIRD */
    carry(game, BIRD + CAGE - obj, game.loc);
  }

  carry(game, obj, game.loc);

  if (obj === BOTTLE && liquid(game) !== NO_OBJECT) {
    game.objects[liquid(game)]!.place = CARRIED;
  }

  if (gstone(obj) && !objectIsFound(game, obj)) {
    objectSetFound(game, obj);
    game.objects[CAVITY]!.prop = CAVITY_EMPTY;
  }
  rspeak(ctx, OK_MAN);
  return GO_CLEAROBJ;
}

/** C: chain (actions.c). Do something to the bear's chain. */
function chain(ctx: IoCtx, verb: number): PhaseCode {
  const game = ctx.game;
  if (verb !== LOCK) {
    if (game.objects[BEAR]!.prop === UNTAMED_BEAR) {
      rspeak(ctx, BEAR_BLOCKS);
      return GO_CLEAROBJ;
    }
    if (game.objects[CHAIN]!.prop === CHAIN_HEAP) {
      rspeak(ctx, ALREADY_UNLOCKED);
      return GO_CLEAROBJ;
    }
    game.objects[CHAIN]!.prop = CHAIN_HEAP;
    game.objects[CHAIN]!.fixed = IS_FREE;
    if (game.objects[BEAR]!.prop !== BEAR_DEAD) {
      game.objects[BEAR]!.prop = CONTENTED_BEAR;
    }

    switch (game.objects[BEAR]!.prop) {
      case BEAR_DEAD:
        game.objects[BEAR]!.fixed = IS_FIXED;
        break;
      default:
        game.objects[BEAR]!.fixed = IS_FREE;
    }
    rspeak(ctx, CHAIN_UNLOCKED);
    return GO_CLEAROBJ;
  }

  if (game.objects[CHAIN]!.prop !== CHAIN_HEAP) {
    rspeak(ctx, ALREADY_LOCKED);
    return GO_CLEAROBJ;
  }
  if (game.loc !== OBJECTS[CHAIN]!.plac) {
    rspeak(ctx, NO_LOCKSITE);
    return GO_CLEAROBJ;
  }

  game.objects[CHAIN]!.prop = CHAIN_FIXED;

  if (toting(game, CHAIN)) {
    drop(game, CHAIN, game.loc);
  }
  game.objects[CHAIN]!.fixed = IS_FIXED;

  rspeak(ctx, CHAIN_LOCKED);
  return GO_CLEAROBJ;
}

/**
 * C: discard (actions.c). Discard object. "Throw" also comes here for most
 * objects. Special cases for bird, cage, vase, gems, and coins at the vending
 * machine.
 */
function discard(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === ROD && !toting(game, ROD) && toting(game, ROD2)) {
    obj = ROD2;
  }

  if (!toting(game, obj)) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }

  if (gstone(obj) && at(game, CAVITY) && game.objects[CAVITY]!.prop !== CAVITY_FULL) {
    rspeak(ctx, GEM_FITS);
    game.objects[obj]!.prop = STATE_IN_CAVITY;
    game.objects[CAVITY]!.prop = CAVITY_FULL;
    if (
      isHere(game, RUG) &&
      ((obj === EMERALD && game.objects[RUG]!.prop !== RUG_HOVER) ||
        (obj === RUBY && game.objects[RUG]!.prop === RUG_HOVER))
    ) {
      if (obj === RUBY) {
        rspeak(ctx, RUG_SETTLES);
      } else if (toting(game, RUG)) {
        rspeak(ctx, RUG_WIGGLES);
      } else {
        rspeak(ctx, RUG_RISES);
      }
      if (!toting(game, RUG) || obj === RUBY) {
        let k = game.objects[RUG]!.prop === RUG_HOVER ? RUG_FLOOR : RUG_HOVER;
        game.objects[RUG]!.prop = k;
        if (k === RUG_HOVER) {
          k = OBJECTS[SAPPH]!.plac;
        }
        move(game, RUG + NOBJECTS, k);
      }
    }
    drop(game, obj, game.loc);
    return GO_CLEAROBJ;
  }

  if (obj === COINS && isHere(game, VEND)) {
    destroy(game, COINS);
    drop(game, BATTERY, game.loc);
    pspeak(ctx, BATTERY, 'look', true, FRESH_BATTERIES);
    return GO_CLEAROBJ;
  }

  if (liquid(game) === obj) {
    obj = BOTTLE;
  }
  if (obj === BOTTLE && liquid(game) !== NO_OBJECT) {
    game.objects[liquid(game)]!.place = LOC_NOWHERE;
  }

  if (obj === BEAR && at(game, TROLL)) {
    stateChange(ctx, TROLL, TROLL_GONE);
    move(game, TROLL, LOC_NOWHERE);
    move(game, TROLL + NOBJECTS, IS_FREE);
    move(game, TROLL2, OBJECTS[TROLL]!.plac);
    move(game, TROLL2 + NOBJECTS, OBJECTS[TROLL]!.fixd);
    juggle(game, CHASM);
    drop(game, obj, game.loc);
    return GO_CLEAROBJ;
  }

  if (obj === VASE) {
    if (game.loc !== OBJECTS[PILLOW]!.plac) {
      stateChange(ctx, VASE, at(game, PILLOW) ? VASE_WHOLE : VASE_DROPPED);
      if (game.objects[VASE]!.prop !== VASE_WHOLE) {
        game.objects[VASE]!.fixed = IS_FIXED;
      }
      drop(game, obj, game.loc);
      return GO_CLEAROBJ;
    }
  }

  if (obj === CAGE && game.objects[BIRD]!.prop === BIRD_CAGED) {
    drop(game, BIRD, game.loc);
  }

  if (obj === BIRD) {
    if (at(game, DRAGON) && game.objects[DRAGON]!.prop === DRAGON_BARS) {
      rspeak(ctx, BIRD_BURNT);
      destroy(game, BIRD);
      return GO_CLEAROBJ;
    }
    if (isHere(game, SNAKE)) {
      rspeak(ctx, BIRD_ATTACKS);
      if (game.closed) {
        return GO_DWARFWAKE;
      }
      destroy(game, SNAKE);
      /* Set game.prop for use by travel options */
      game.objects[SNAKE]!.prop = SNAKE_CHASED;
    } else {
      rspeak(ctx, OK_MAN);
    }

    game.objects[BIRD]!.prop = forest(game.loc) ? BIRD_FOREST_UNCAGED : BIRD_UNCAGED;
    drop(game, obj, game.loc);
    return GO_CLEAROBJ;
  }

  rspeak(ctx, OK_MAN);
  drop(game, obj, game.loc);
  return GO_CLEAROBJ;
}

/**
 * C: drink (actions.c). If no object, assume water and look for it here. If
 * water is in the bottle, drink that, else must be at a water loc.
 */
function drink(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  if (
    obj === INTRANSITIVE &&
    liqloc(game.loc) !== WATER &&
    (liquid(game) !== WATER || !isHere(game, BOTTLE))
  ) {
    return GO_UNKNOWN;
  }

  if (obj === BLOOD) {
    destroy(game, BLOOD);
    stateChange(ctx, DRAGON, DRAGON_BLOODLESS);
    game.blooded = true;
    return GO_CLEAROBJ;
  }

  if (obj !== INTRANSITIVE && obj !== WATER) {
    rspeak(ctx, RIDICULOUS_ATTEMPT);
    return GO_CLEAROBJ;
  }
  if (liquid(game) === WATER && isHere(game, BOTTLE)) {
    game.objects[WATER]!.place = LOC_NOWHERE;
    stateChange(ctx, BOTTLE, EMPTY_BOTTLE);
    return GO_CLEAROBJ;
  }

  speak(ctx, verbMessage(verb));
  return GO_CLEAROBJ;
}

/** C: eat (actions.c). Intransitive: assume food if present, else ask what. */
function eat(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  let fallthrough = false;
  if (obj === INTRANSITIVE) {
    if (!isHere(game, FOOD)) {
      return GO_UNKNOWN;
    }
    fallthrough = true;
  }
  if (fallthrough || obj === FOOD) {
    destroy(game, FOOD);
    rspeak(ctx, THANKS_DELICIOUS);
    return GO_CLEAROBJ;
  }
  switch (obj) {
    case BIRD:
    case SNAKE:
    case CLAM:
    case OYSTER:
    case DWARF:
    case DRAGON:
    case TROLL:
    case BEAR:
    case OGRE:
      rspeak(ctx, LOST_APPETITE);
      break;
    default:
      speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/** C: extinguish (actions.c). Lamp, urn, dragon/volcano (nice try). */
function extinguish(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === INTRANSITIVE) {
    if (isHere(game, LAMP) && game.objects[LAMP]!.prop === LAMP_BRIGHT) {
      obj = LAMP;
    }
    if (isHere(game, URN) && game.objects[URN]!.prop === URN_LIT) {
      obj = URN;
    }
    if (obj === INTRANSITIVE) {
      return GO_UNKNOWN;
    }
  }

  switch (obj) {
    case URN:
      if (game.objects[URN]!.prop !== URN_EMPTY) {
        stateChange(ctx, URN, URN_DARK);
      } else {
        pspeak(ctx, URN, 'change', true, URN_DARK);
      }
      break;
    case LAMP:
      stateChange(ctx, LAMP, LAMP_DARK);
      rspeak(ctx, isDarkHere(game) ? PITCH_DARK : NO_MESSAGE);
      break;
    case DRAGON:
    case VOLCANO:
      rspeak(ctx, BEYOND_POWER);
      break;
    default:
      speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/**
 * C: feed (actions.c). If bird, no seed. Snake, dragon, troll: quip. If
 * dwarf, make him mad. Bear, special.
 */
function feed(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  switch (obj) {
    case BIRD:
      rspeak(ctx, BIRD_PINING);
      break;
    case DRAGON:
      if (game.objects[DRAGON]!.prop !== DRAGON_BARS) {
        rspeak(ctx, RIDICULOUS_ATTEMPT);
      } else {
        rspeak(ctx, NOTHING_EDIBLE);
      }
      break;
    case SNAKE:
      if (!game.closed && isHere(game, BIRD)) {
        destroy(game, BIRD);
        rspeak(ctx, BIRD_DEVOURED);
      } else {
        rspeak(ctx, NOTHING_EDIBLE);
      }
      break;
    case TROLL:
      rspeak(ctx, TROLL_VICES);
      break;
    case DWARF:
      if (isHere(game, FOOD)) {
        game.dflag += 2;
        rspeak(ctx, REALLY_MAD);
      } else {
        speak(ctx, verbMessage(verb));
      }
      break;
    case BEAR:
      if (game.objects[BEAR]!.prop === BEAR_DEAD) {
        rspeak(ctx, RIDICULOUS_ATTEMPT);
        break;
      }
      if (game.objects[BEAR]!.prop === UNTAMED_BEAR) {
        if (isHere(game, FOOD)) {
          destroy(game, FOOD);
          game.objects[AXE]!.fixed = IS_FREE;
          game.objects[AXE]!.prop = AXE_HERE;
          stateChange(ctx, BEAR, SITTING_BEAR);
        } else {
          rspeak(ctx, NOTHING_EDIBLE);
        }
        break;
      }
      speak(ctx, verbMessage(verb));
      break;
    case OGRE:
      if (isHere(game, FOOD)) {
        rspeak(ctx, OGRE_FULL);
      } else {
        speak(ctx, verbMessage(verb));
      }
      break;
    default:
      rspeak(ctx, AM_GAME);
  }
  return GO_CLEAROBJ;
}

/**
 * C: fill (actions.c). Bottle or urn must be empty, and liquid available.
 * (Vase is nasty.)
 */
function fill(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  if (obj === VASE) {
    if (liqloc(game.loc) === NO_OBJECT) {
      rspeak(ctx, FILL_INVALID);
      return GO_CLEAROBJ;
    }
    if (!toting(game, VASE)) {
      rspeak(ctx, ARENT_CARRYING);
      return GO_CLEAROBJ;
    }
    rspeak(ctx, SHATTER_VASE);
    game.objects[VASE]!.prop = VASE_BROKEN;
    game.objects[VASE]!.fixed = IS_FIXED;
    drop(game, VASE, game.loc);
    return GO_CLEAROBJ;
  }

  if (obj === URN) {
    if (game.objects[URN]!.prop !== URN_EMPTY) {
      rspeak(ctx, FULL_URN);
      return GO_CLEAROBJ;
    }
    if (!isHere(game, BOTTLE)) {
      rspeak(ctx, FILL_INVALID);
      return GO_CLEAROBJ;
    }
    const k = liquid(game);
    switch (k) {
      case WATER:
        game.objects[BOTTLE]!.prop = EMPTY_BOTTLE;
        rspeak(ctx, WATER_URN);
        break;
      case OIL:
        game.objects[URN]!.prop = URN_DARK;
        game.objects[BOTTLE]!.prop = EMPTY_BOTTLE;
        rspeak(ctx, OIL_URN);
        break;
      case NO_OBJECT:
      default:
        rspeak(ctx, FILL_INVALID);
        return GO_CLEAROBJ;
    }
    game.objects[k]!.place = LOC_NOWHERE;
    return GO_CLEAROBJ;
  }
  if (obj !== INTRANSITIVE && obj !== BOTTLE) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }
  if (obj === INTRANSITIVE && !isHere(game, BOTTLE)) {
    return GO_UNKNOWN;
  }

  if (isHere(game, URN) && game.objects[URN]!.prop !== URN_EMPTY) {
    rspeak(ctx, URN_NOPOUR);
    return GO_CLEAROBJ;
  }
  if (liquid(game) !== NO_OBJECT) {
    rspeak(ctx, BOTTLE_FULL);
    return GO_CLEAROBJ;
  }
  if (liqloc(game.loc) === NO_OBJECT) {
    rspeak(ctx, NO_LIQUID);
    return GO_CLEAROBJ;
  }

  stateChange(ctx, BOTTLE, liqloc(game.loc) === OIL ? OIL_BOTTLE : WATER_BOTTLE);
  if (toting(game, BOTTLE)) {
    game.objects[liquid(game)]!.place = CARRIED;
  }
  return GO_CLEAROBJ;
}

/** C: find (actions.c). Might be carrying it, or it might be here. */
function find(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  if (toting(game, obj)) {
    rspeak(ctx, ALREADY_CARRYING);
    return GO_CLEAROBJ;
  }

  if (game.closed) {
    rspeak(ctx, NEEDED_NEARBY);
    return GO_CLEAROBJ;
  }

  if (
    at(game, obj) ||
    (liquid(game) === obj && at(game, BOTTLE)) ||
    obj === liqloc(game.loc) ||
    (obj === DWARF && atdwrf(game, game.loc) > 0)
  ) {
    rspeak(ctx, YOU_HAVEIT);
    return GO_CLEAROBJ;
  }

  speak(ctx, verbMessage(verb));
  return GO_CLEAROBJ;
}

/** C: fly (actions.c). Snide remarks unless hovering rug is here. */
function fly(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === INTRANSITIVE) {
    if (!isHere(game, RUG)) {
      rspeak(ctx, FLAP_ARMS);
      return GO_CLEAROBJ;
    }
    if (game.objects[RUG]!.prop !== RUG_HOVER) {
      rspeak(ctx, RUG_NOTHING2);
      return GO_CLEAROBJ;
    }
    obj = RUG;
  }

  if (obj !== RUG) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }
  if (game.objects[RUG]!.prop !== RUG_HOVER) {
    rspeak(ctx, RUG_NOTHING1);
    return GO_CLEAROBJ;
  }

  if (game.loc === LOC_CLIFF) {
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    game.newloc = LOC_LEDGE;
    rspeak(ctx, RUG_GOES);
  } else if (game.loc === LOC_LEDGE) {
    game.oldlc2 = game.oldloc;
    game.oldloc = game.loc;
    game.newloc = LOC_CLIFF;
    rspeak(ctx, RUG_RETURNS);
  } else {
    /* should never happen */
    rspeak(ctx, NOTHING_HAPPENS);
  }
  return GO_TERMINATE;
}

/** C: inven (actions.c). Report on current burden. */
function inven(ctx: IoCtx): PhaseCode {
  const game = ctx.game;
  let empty = true;
  for (let i = 1; i < NOBJECTS; i++) {
    if (i === BEAR || !toting(game, i)) {
      continue;
    }
    if (empty) {
      rspeak(ctx, NOW_HOLDING);
      empty = false;
    }
    pspeak(ctx, i, 'touch', false, -1);
  }
  if (toting(game, BEAR)) {
    rspeak(ctx, TAME_BEAR);
  }
  if (empty) {
    rspeak(ctx, NO_CARRY);
  }
  return GO_CLEAROBJ;
}

/** C: light (actions.c). Applicable only to lamp and urn. */
function light(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === INTRANSITIVE) {
    let selects = 0;
    if (isHere(game, LAMP) && game.objects[LAMP]!.prop === LAMP_DARK && game.limit >= 0) {
      obj = LAMP;
      selects++;
    }
    if (isHere(game, URN) && game.objects[URN]!.prop === URN_DARK) {
      obj = URN;
      selects++;
    }
    if (selects !== 1) {
      return GO_UNKNOWN;
    }
  }

  switch (obj) {
    case URN:
      stateChange(ctx, URN, game.objects[URN]!.prop === URN_EMPTY ? URN_EMPTY : URN_LIT);
      break;
    case LAMP:
      if (game.limit < 0) {
        rspeak(ctx, LAMP_OUT);
        break;
      }
      stateChange(ctx, LAMP, LAMP_BRIGHT);
      if (game.wzdark) {
        return GO_TOP;
      }
      break;
    default:
      speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/** C: listen (actions.c). Print stuff based on object sound properties. */
function listen(ctx: IoCtx): PhaseCode {
  const game = ctx.game;
  let soundlatch = false;
  const loc = LOCATIONS[game.loc]!;
  const sound = loc.sound;
  if (sound !== SILENT) {
    rspeak(ctx, sound);
    if (!loc.loud) {
      rspeak(ctx, NO_MESSAGE);
    }
    soundlatch = true;
  }
  for (let i = 1; i < NOBJECTS; i++) {
    if (
      !isHere(game, i) ||
      (OBJECTS[i]!.sounds?.[0] ?? null) === null ||
      objectIsStashed(game, i) ||
      objectIsNotFound(game, i)
    ) {
      continue;
    }
    let mi = game.objects[i]!.prop;
    /* (ESR) Some unpleasant magic on object states here. Ideally we'd have
     * liked the bird to be a normal object that we can use state_change() on;
     * can't do it, because there are actually two different series of
     * per-state birdsounds depending on whether player has drunk dragon's
     * blood. */
    if (i === BIRD) {
      mi += 3 * (game.blooded ? 1 : 0);
    }
    pspeak(ctx, i, 'hear', true, mi, game.zzword);
    rspeak(ctx, NO_MESSAGE);
    if (i === BIRD && mi === BIRD_ENDSTATE) {
      destroy(game, BIRD);
    }
    soundlatch = true;
  }
  if (!soundlatch) {
    rspeak(ctx, ALL_SILENT);
  }
  return GO_CLEAROBJ;
}

/** C: lock (actions.c). Lock, unlock, no object given. Assume various things. */
function lock(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === INTRANSITIVE) {
    if (isHere(game, CLAM)) {
      obj = CLAM;
    }
    if (isHere(game, OYSTER)) {
      obj = OYSTER;
    }
    if (at(game, DOOR)) {
      obj = DOOR;
    }
    if (at(game, GRATE)) {
      obj = GRATE;
    }
    if (isHere(game, CHAIN)) {
      obj = CHAIN;
    }
    if (obj === INTRANSITIVE) {
      rspeak(ctx, NOTHING_LOCKED);
      return GO_CLEAROBJ;
    }
  }

  /* Lock, unlock object. Special stuff for opening clam/oyster and for chain. */
  switch (obj) {
    case CHAIN:
      if (isHere(game, KEYS)) {
        return chain(ctx, verb);
      }
      rspeak(ctx, NO_KEYS);
      break;
    case GRATE:
      if (isHere(game, KEYS)) {
        if (game.closng) {
          rspeak(ctx, EXIT_CLOSED);
          if (!game.panic) {
            game.clock2 = PANICTIME;
          }
          game.panic = true;
        } else {
          stateChange(ctx, GRATE, verb === LOCK ? GRATE_CLOSED : GRATE_OPEN);
        }
      } else {
        rspeak(ctx, NO_KEYS);
      }
      break;
    case CLAM:
      if (verb === LOCK) {
        rspeak(ctx, HUH_MAN);
      } else if (toting(game, CLAM)) {
        rspeak(ctx, DROP_CLAM);
      } else if (!toting(game, TRIDENT)) {
        rspeak(ctx, CLAM_OPENER);
      } else {
        destroy(game, CLAM);
        drop(game, OYSTER, game.loc);
        drop(game, PEARL, LOC_CULDESAC);
        rspeak(ctx, PEARL_FALLS);
      }
      break;
    case OYSTER:
      if (verb === LOCK) {
        rspeak(ctx, HUH_MAN);
      } else if (toting(game, OYSTER)) {
        rspeak(ctx, DROP_OYSTER);
      } else if (!toting(game, TRIDENT)) {
        rspeak(ctx, OYSTER_OPENER);
      } else {
        rspeak(ctx, OYSTER_OPENS);
      }
      break;
    case DOOR:
      rspeak(ctx, game.objects[DOOR]!.prop === DOOR_UNRUSTED ? OK_MAN : RUSTY_DOOR);
      break;
    case CAGE:
      rspeak(ctx, NO_LOCK);
      break;
    case KEYS:
      rspeak(ctx, CANNOT_UNLOCK);
      break;
    default:
      speak(ctx, verbMessage(verb));
  }

  return GO_CLEAROBJ;
}

/**
 * C: pour (actions.c). If no object, or object is bottle, assume contents of
 * bottle. Special tests for pouring water or oil on plant or rusty door.
 */
function pour(ctx: IoCtx, verb: number, objIn: number): PhaseCode {
  const game = ctx.game;
  let obj = objIn;
  if (obj === BOTTLE || obj === INTRANSITIVE) {
    obj = liquid(game);
  }
  if (obj === NO_OBJECT) {
    return GO_UNKNOWN;
  }
  if (!toting(game, obj)) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }

  if (obj !== OIL && obj !== WATER) {
    rspeak(ctx, CANT_POUR);
    return GO_CLEAROBJ;
  }
  if (isHere(game, URN) && game.objects[URN]!.prop === URN_EMPTY) {
    return fill(ctx, verb, URN);
  }
  game.objects[BOTTLE]!.prop = EMPTY_BOTTLE;
  game.objects[obj]!.place = LOC_NOWHERE;
  if (!(at(game, PLANT) || at(game, DOOR))) {
    rspeak(ctx, GROUND_WET);
    return GO_CLEAROBJ;
  }
  if (!at(game, DOOR)) {
    if (obj === WATER) {
      /* cycle through the three plant states */
      stateChange(ctx, PLANT, (game.objects[PLANT]!.prop + 1) % 3);
      game.objects[PLANT2]!.prop = game.objects[PLANT]!.prop;
      return GO_MOVE;
    }
    rspeak(ctx, SHAKING_LEAVES);
    return GO_CLEAROBJ;
  }
  stateChange(ctx, DOOR, obj === OIL ? DOOR_UNRUSTED : DOOR_RUSTED);
  return GO_CLEAROBJ;
}

/** C: reservoir (actions.c). Z'ZZZ (word gets recomputed at startup). */
function reservoir(ctx: IoCtx): PhaseCode {
  const game = ctx.game;
  if (!at(game, RESER) && game.loc !== LOC_RESBOTTOM) {
    rspeak(ctx, NOTHING_HAPPENS);
    return GO_CLEAROBJ;
  }
  stateChange(
    ctx,
    RESER,
    game.objects[RESER]!.prop === WATERS_PARTED ? WATERS_UNPARTED : WATERS_PARTED,
  );
  if (at(game, RESER)) {
    return GO_CLEAROBJ;
  }
  game.oldlc2 = game.loc;
  game.newloc = LOC_NOWHERE;
  rspeak(ctx, NOT_BRIGHT);
  return GO_TERMINATE;
}

/** C: rub (actions.c). Yields various snide remarks except for lit urn. */
function rub(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  if (obj === URN && game.objects[URN]!.prop === URN_LIT) {
    destroy(game, URN);
    drop(game, AMBER, game.loc);
    game.objects[AMBER]!.prop = AMBER_IN_ROCK;
    --game.tally;
    drop(game, CAVITY, game.loc);
    rspeak(ctx, URN_GENIES);
  } else if (obj !== LAMP) {
    rspeak(ctx, PECULIAR_NOTHING);
  } else {
    speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/** C: say (actions.c). Echo WD2. Magic words override. */
function say(ctx: IoCtx, session: Session, command: CommandT): ActionResult {
  const w1 = command.word[1];
  if (
    w1.type === WORD_MOTION &&
    (w1.id === XYZZY || w1.id === PLUGH || w1.id === PLOVER)
  ) {
    return GO_WORD2;
  }
  if (w1.type === WORD_ACTION && w1.id === PART) {
    return reservoir(ctx);
  }

  if (
    w1.type === WORD_ACTION &&
    (w1.id === FEE || w1.id === FIE || w1.id === FOE || w1.id === FOO || w1.id === FUM || w1.id === PART)
  ) {
    return bigwords(ctx, session, w1.id);
  }
  sspeak(ctx, OKEY_DOKEY, w1.raw);
  return GO_CLEAROBJ;
}

/** C: throw_support (actions.c). */
function throwSupport(ctx: IoCtx, spk: number): PhaseCode {
  rspeak(ctx, spk);
  drop(ctx.game, AXE, ctx.game.loc);
  return GO_MOVE;
}

/**
 * C: throwit (actions.c). Same as discard unless axe. Then same as attack
 * except ignore bird, and if dwarf is present then one might be killed.
 */
function throwit(
  ctx: IoCtx,
  session: Session,
  command: CommandT,
  env?: RngEnv,
): ActionResult {
  const game = ctx.game;
  if (!toting(game, command.obj)) {
    speak(ctx, verbMessage(command.verb));
    return GO_CLEAROBJ;
  }
  if (OBJECTS[command.obj]!.isTreasure && at(game, TROLL)) {
    /* Snarf a treasure for the troll. */
    drop(game, command.obj, LOC_NOWHERE);
    move(game, TROLL, LOC_NOWHERE);
    move(game, TROLL + NOBJECTS, IS_FREE);
    drop(game, TROLL2, OBJECTS[TROLL]!.plac);
    drop(game, TROLL2 + NOBJECTS, OBJECTS[TROLL]!.fixd);
    juggle(game, CHASM);
    rspeak(ctx, TROLL_SATISFIED);
    return GO_CLEAROBJ;
  }
  if (command.obj === FOOD && isHere(game, BEAR)) {
    /* But throwing food is another story. */
    return feed(ctx, command.verb, BEAR);
  }
  if (command.obj !== AXE) {
    return discard(ctx, command.verb, command.obj);
  }
  if (atdwrf(game, game.loc) <= 0) {
    if (at(game, DRAGON) && game.objects[DRAGON]!.prop === DRAGON_BARS) {
      return throwSupport(ctx, DRAGON_SCALES);
    }
    if (at(game, TROLL)) {
      return throwSupport(ctx, TROLL_RETURNS);
    }
    if (at(game, OGRE)) {
      return throwSupport(ctx, OGRE_DODGE);
    }
    if (isHere(game, BEAR) && game.objects[BEAR]!.prop === UNTAMED_BEAR) {
      /* This'll teach him to throw the axe at the bear! */
      drop(game, AXE, game.loc);
      game.objects[AXE]!.fixed = IS_FIXED;
      juggle(game, BEAR);
      stateChange(ctx, AXE, AXE_LOST);
      return GO_CLEAROBJ;
    }
    return attack(ctx, session, { ...command, obj: INTRANSITIVE });
  }

  if (randrange(game, NDWARVES + 1, env) < game.dflag) {
    return throwSupport(ctx, DWARF_DODGES);
  }
  const i = atdwrf(game, game.loc);
  game.dwarves[i]!.seen = false;
  game.dwarves[i]!.loc = LOC_NOWHERE;
  return throwSupport(ctx, ++game.dkill === 1 ? DWARF_SMOKE : KILLED_DWARF);
}

/** C: wake (actions.c). Only use is to disturb the dwarves. */
function wake(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  if (obj !== DWARF || !ctx.game.closed) {
    speak(ctx, verbMessage(verb));
    return GO_CLEAROBJ;
  }
  rspeak(ctx, PROD_DWARF);
  return GO_DWARFWAKE;
}

/** C: seed (actions.c). Set seed. */
function seed(ctx: IoCtx, verb: number, arg: string, env?: RngEnv): PhaseCode {
  const seedval = cStrtol(arg);
  speak(ctx, verbMessage(verb), seedval);
  setSeed(ctx.game, seedval, env);
  --ctx.game.turns;
  return GO_TOP;
}

/** C: waste (actions.c). Burn turns. */
function waste(ctx: IoCtx, verb: number, turns: number): PhaseCode {
  ctx.game.limit = (ctx.game.limit - turns) | 0;
  speak(ctx, verbMessage(verb), ctx.game.limit);
  return GO_TOP;
}

/**
 * C: wave (actions.c). No effect unless waving rod at fissure or at bird.
 */
function wave(ctx: IoCtx, verb: number, obj: number): PhaseCode {
  const game = ctx.game;
  if (
    obj !== ROD ||
    !toting(game, obj) ||
    (!isHere(game, BIRD) && (game.closng || !at(game, FISSURE)))
  ) {
    speak(
      ctx,
      !toting(game, obj) && (obj !== ROD || !toting(game, ROD2))
        ? (ARBITRARY_MESSAGES[ARENT_CARRYING] ?? null)
        : verbMessage(verb),
    );
    return GO_CLEAROBJ;
  }

  if (
    game.objects[BIRD]!.prop === BIRD_UNCAGED &&
    game.loc === game.objects[STEPS]!.place &&
    objectIsNotFound(game, JADE)
  ) {
    drop(game, JADE, game.loc);
    objectSetFound(game, JADE);
    --game.tally;
    rspeak(ctx, NECKLACE_FLY);
    return GO_CLEAROBJ;
  }
  if (game.closed) {
    rspeak(ctx, game.objects[BIRD]!.prop === BIRD_CAGED ? CAGE_FLY : FREE_FLY);
    return GO_DWARFWAKE;
  }
  if (game.closng || !at(game, FISSURE)) {
    rspeak(ctx, game.objects[BIRD]!.prop === BIRD_CAGED ? CAGE_FLY : FREE_FLY);
    return GO_CLEAROBJ;
  }
  if (isHere(game, BIRD)) {
    rspeak(ctx, game.objects[BIRD]!.prop === BIRD_CAGED ? CAGE_FLY : FREE_FLY);
  }

  stateChange(ctx, FISSURE, game.objects[FISSURE]!.prop === BRIDGED ? UNBRIDGED : BRIDGED);
  return GO_CLEAROBJ;
}

/**
 * C: action (actions.c). Analyse a verb. Remember what it was, go back for
 * object if second word unless verb is "say", which snarfs arbitrary second
 * word. `cmd` is passed by value in C, so it is copied here.
 */
export function action(
  ctx: IoCtx,
  session: Session,
  cmd: CommandT,
  env?: RngEnv,
): ActionResult {
  const game = ctx.game;
  const command: CommandT = { ...cmd, word: [cmd.word[0], cmd.word[1]] };

  if (ACTIONS[command.verb]!.noaction) {
    speak(ctx, verbMessage(command.verb));
    return GO_CLEAROBJ;
  }

  if (command.part === PART_UNKNOWN) {
    /* Analyse an object word. See if the thing is here, whether we've got a
     * verb yet, and so on. Object must be here unless verb is "find" or
     * "invent(ory)" (and no new verb yet to be analysed). Water and oil are
     * also funny, since they are never actually dropped at any location, but
     * might be here inside the bottle or urn or as a feature of the
     * location. */
    if (isHere(game, command.obj)) {
      /* FALL THROUGH */
    } else if (command.obj === DWARF && atdwrf(game, game.loc) > 0) {
      /* FALL THROUGH */
    } else if (
      !game.closed &&
      ((liquid(game) === command.obj && isHere(game, BOTTLE)) ||
        command.obj === liqloc(game.loc))
    ) {
      /* FALL THROUGH */
    } else if (
      command.obj === OIL &&
      isHere(game, URN) &&
      game.objects[URN]!.prop !== URN_EMPTY
    ) {
      command.obj = URN;
    } else if (
      command.obj === PLANT &&
      at(game, PLANT2) &&
      game.objects[PLANT2]!.prop !== PLANT_THIRSTY
    ) {
      command.obj = PLANT2;
    } else if (command.obj === KNIFE && game.knfloc === game.loc) {
      game.knfloc = -1;
      rspeak(ctx, KNIVES_VANISH);
      return GO_CLEAROBJ;
    } else if (command.obj === ROD && isHere(game, ROD2)) {
      command.obj = ROD2;
    } else if (
      (command.verb === FIND || command.verb === INVENTORY) &&
      (command.word[1].id === WORD_EMPTY || command.word[1].id === WORD_NOT_FOUND)
    ) {
      /* FALL THROUGH */
    } else {
      sspeak(ctx, NO_SEE, command.word[0].raw);
      return GO_CLEAROBJ;
    }

    if (command.verb !== 0) {
      command.part = PART_TRANSITIVE;
    }
  }

  switch (command.part) {
    case PART_INTRANSITIVE:
    case PART_TRANSITIVE: {
      if (command.part === PART_INTRANSITIVE) {
        if (command.word[1].raw.length > 0 && command.verb !== SAY) {
          return GO_WORD2;
        }
        if (command.verb === SAY) {
          /* KEYS is not special, anything not NO_OBJECT or INTRANSITIVE will
           * do here. We're preventing interpretation as an intransitive verb
           * when the word is unknown. */
          command.obj = command.word[1].raw.length > 0 ? KEYS : NO_OBJECT;
        }
        if (command.obj === NO_OBJECT || command.obj === INTRANSITIVE) {
          /* Analyse an intransitive verb (ie, no object given yet). */
          return intransitive(ctx, session, command, env);
        }
      }
      /* Analyse a transitive verb. */
      return transitive(ctx, session, command, env);
    }
    case PART_UNKNOWN:
      /* Unknown verb, couldn't deduce object - might need hint */
      sspeak(ctx, WHAT_DO, command.word[0].raw);
      return GO_CHECKHINT;
    default:
      throw new EngineBug('SPEECHPART_NOT_TRANSITIVE_OR_INTRANSITIVE_OR_UNKNOWN');
  }
}

/** C: action (actions.c), the `case intransitive` verb table. */
function intransitive(
  ctx: IoCtx,
  session: Session,
  command: CommandT,
  _env?: RngEnv,
): ActionResult {
  switch (command.verb) {
    case CARRY:
      return vcarry(ctx, command.verb, INTRANSITIVE);
    case DROP:
      return GO_UNKNOWN;
    case SAY:
      return GO_UNKNOWN;
    case UNLOCK:
      return lock(ctx, command.verb, INTRANSITIVE);
    case NOTHING:
      rspeak(ctx, OK_MAN);
      return GO_CLEAROBJ;
    case LOCK:
      return lock(ctx, command.verb, INTRANSITIVE);
    case LIGHT:
      return light(ctx, command.verb, INTRANSITIVE);
    case EXTINGUISH:
      return extinguish(ctx, command.verb, INTRANSITIVE);
    case WAVE:
      return GO_UNKNOWN;
    case TAME:
      return GO_UNKNOWN;
    case GO:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case ATTACK:
      return attack(ctx, session, { ...command, obj: INTRANSITIVE });
    case POUR:
      return pour(ctx, command.verb, INTRANSITIVE);
    case EAT:
      return eat(ctx, command.verb, INTRANSITIVE);
    case DRINK:
      return drink(ctx, command.verb, INTRANSITIVE);
    case RUB:
      return GO_UNKNOWN;
    case THROW:
      return GO_UNKNOWN;
    case QUIT:
      return quit(ctx, session);
    case FIND:
      return GO_UNKNOWN;
    case INVENTORY:
      return inven(ctx);
    case FEED:
      return GO_UNKNOWN;
    case FILL:
      return fill(ctx, command.verb, INTRANSITIVE);
    case BLAST:
      blast(ctx, session);
      return GO_CLEAROBJ;
    case SCORE:
      scoreGame(ctx, 'scoregame');
      return GO_CLEAROBJ;
    case FEE:
    case FIE:
    case FOE:
    case FOO:
    case FUM:
      return bigwords(ctx, session, command.word[0].id);
    case BRIEF:
      return brief(ctx);
    case READ:
      return read(ctx, session, { ...command, obj: INTRANSITIVE });
    case BREAK:
      return GO_UNKNOWN;
    case WAKE:
      return GO_UNKNOWN;
    case SAVE:
      return suspend(ctx, session);
    case RESUME:
      return resume(ctx, session);
    case FLY:
      return fly(ctx, command.verb, INTRANSITIVE);
    case LISTEN:
      return listen(ctx);
    case PART:
      return reservoir(ctx);
    case SEED:
    case WASTE:
      rspeak(ctx, NUMERIC_REQUIRED);
      return GO_TOP;
    default:
      throw new EngineBug('INTRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST');
  }
}

/** C: action (actions.c), the `case transitive` verb table. */
function transitive(
  ctx: IoCtx,
  session: Session,
  command: CommandT,
  env?: RngEnv,
): ActionResult {
  switch (command.verb) {
    case CARRY:
      return vcarry(ctx, command.verb, command.obj);
    case DROP:
      return discard(ctx, command.verb, command.obj);
    case SAY:
      return say(ctx, session, command);
    case UNLOCK:
      return lock(ctx, command.verb, command.obj);
    case NOTHING:
      rspeak(ctx, OK_MAN);
      return GO_CLEAROBJ;
    case LOCK:
      return lock(ctx, command.verb, command.obj);
    case LIGHT:
      return light(ctx, command.verb, command.obj);
    case EXTINGUISH:
      return extinguish(ctx, command.verb, command.obj);
    case WAVE:
      return wave(ctx, command.verb, command.obj);
    case TAME:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case GO:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case ATTACK:
      return attack(ctx, session, command);
    case POUR:
      return pour(ctx, command.verb, command.obj);
    case EAT:
      return eat(ctx, command.verb, command.obj);
    case DRINK:
      return drink(ctx, command.verb, command.obj);
    case RUB:
      return rub(ctx, command.verb, command.obj);
    case THROW:
      return throwit(ctx, session, command, env);
    case QUIT:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case FIND:
      return find(ctx, command.verb, command.obj);
    case INVENTORY:
      return find(ctx, command.verb, command.obj);
    case FEED:
      return feed(ctx, command.verb, command.obj);
    case FILL:
      return fill(ctx, command.verb, command.obj);
    case BLAST:
      blast(ctx, session);
      return GO_CLEAROBJ;
    case SCORE:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case FEE:
    case FIE:
    case FOE:
    case FOO:
    case FUM:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case BRIEF:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case READ:
      return read(ctx, session, command);
    case BREAK:
      return vbreak(ctx, command.verb, command.obj);
    case WAKE:
      return wake(ctx, command.verb, command.obj);
    case SAVE:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case RESUME:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case FLY:
      return fly(ctx, command.verb, command.obj);
    case LISTEN:
      speak(ctx, verbMessage(command.verb));
      return GO_CLEAROBJ;
    case PART:
      return reservoir(ctx);
    case SEED:
      return seed(ctx, command.verb, command.word[1].raw, env);
    case WASTE:
      return waste(ctx, command.verb, cStrtol(command.word[1].raw));
    default:
      throw new EngineBug('TRANSITIVE_ACTION_VERB_EXCEEDS_GOTO_LIST');
  }
}
