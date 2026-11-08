/*
 * Main loop of the Open Adventure TypeScript port.
 *
 * Ported from Open Adventure main.c (https://gitlab.com/esr/open-adventure).
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
 *
 * Control flow. The C program blocks on stdin in nine places. Here each of
 * them stores a Pending tag in `session.pending` and returns; the matching
 * branch of `mainStep` re-enters the ported control flow at the exact C
 * continuation. `do_command` is an explicit stage machine (see CmdStage) so
 * any stage can be re-entered. These functions mutate the state they are
 * given and return the events produced; the public API (index.ts) clones the
 * input state first.
 */

import {
  AXE,
  AXE_HERE,
  BATTERY,
  BEAR,
  BEAR_DEAD,
  BIRD,
  CAVE_CLOSED,
  CAVE_CLOSING,
  CAVE_NEARBY,
  CHAIN,
  CHAIN_HEAP,
  CHAINING_BEAR,
  CHASM,
  COND_HBASE,
  COND_NOARRR,
  DEAD_BATTERIES,
  DEATH_CLOSING,
  DONT_KNOW,
  DO_WHAT,
  DWARF,
  DWARF_BLOCK,
  DWARVES_AWAKEN,
  EGGS,
  EMERALD,
  EMPTY_BOTTLE,
  ENDGAME_SIGN,
  EXIT_CLOSED,
  FISSURE,
  FRESH_BATTERIES,
  GET_BATTERIES,
  GO_UNNEEDED,
  GRATE,
  GRATE_CLOSED,
  HERE as MOTION_HERE,
  HINT_COST,
  JADE,
  KEYS,
  LAMP,
  LAMP_BRIGHT,
  LAMP_DARK,
  LAMP_DIM,
  LAMP_OUT,
  LOC_BUILDING,
  LOC_NE,
  LOC_NOWHERE,
  LOC_START,
  LOC_SW,
  LOC_Y2,
  MIRROR,
  MISSING_BATTERIES,
  NDEATHS,
  NDWARVES,
  NHINTS,
  NO_MESSAGE,
  NO_OBJECT,
  NOBJECTS,
  NTHRESHOLDS,
  NUGGET,
  NUL,
  OGRE,
  OIL,
  OK_MAN,
  OYSTER,
  PILLOW,
  PIT_FALL,
  PITCH_DARK,
  PLANT,
  PLANT_THIRSTY,
  PLOVER,
  PLUGH,
  PYRAMID,
  REPLACE_BATTERIES,
  ROD,
  ROD2,
  RUG,
  RUG_DRAGON,
  SAYS_PLUGH,
  SIGN,
  SNAKE,
  SNAKE_CHASED,
  STEPS,
  STEPS_DOWN,
  STEPS_UP,
  TAME_BEAR,
  TROLL,
  TROLL2,
  UNBRIDGED,
  W_IS_WEST,
  WANT_HINT,
  WATER,
  WELCOME_YOU,
  XYZZY,
  BIRD_CAGED,
  CAGE,
  BOTTLE,
} from '../data/constants';
import {
  ARBITRARY_MESSAGES,
  HINTS,
  LOCATIONS,
  OBITUARIES,
  OBJECTS,
  TURN_THRESHOLDS,
} from '../data/dungeon';
import { action } from './actions';
import {
  BLOCKED,
  GO_CHECKHINT,
  GO_CLEAROBJ,
  GO_DWARFWAKE,
  GO_MOVE,
  GO_TERMINATE,
  GO_TOP,
  GO_UNKNOWN,
  GO_WORD2,
  resumeClue,
  resumeDragon,
  resumeQuit,
  resumeResumeConfirm,
  resumeSuspendConfirm,
} from './actions-special';
import type { ActionResult } from './actions-special';
import {
  ACTION,
  CMD_EXECUTED,
  CMD_GIVEN,
  CMD_PREPROCESSED,
  CMD_PROCESSING,
  MOTION,
  NO_WORD_TYPE,
  NUMERIC,
  OBJECT,
  clearCommand,
  getCommandInput,
  preprocessCommand,
} from './classic-parser';
import { dwarfmove } from './dwarves';
import {
  answerYesNo,
  askYesNo,
  beginInput,
  eofInput,
  pspeak,
  receiveInput,
  rspeak,
  speak,
  sspeak,
} from './io';
import type { IoCtx } from './io';
import {
  BATTERYLIFE,
  CONDITIONS_EFFECTIVE,
  NOVICELIMIT,
  PANICTIME,
  PIT_KILL_PROB,
  WARNTIME,
  WORD_EMPTY,
  WORD_NOT_FOUND,
  atdwrf,
  cndbit,
  destroy,
  drop,
  forced,
  indeep,
  IS_FREE,
  isDarkHere,
  isHere,
  juggle,
  move,
  objectIsNotFound,
  objectIsStashed,
  objectSetFound,
  objectStashify,
  outside,
  put,
  toting,
} from './objects';
import { pct } from './rng';
import {
  eofFileNameStage,
  resumeResumeFile,
  resumeSuspendFile,
  restore,
} from './save-resume';
import { computeScore, terminate } from './score';
import { playermove } from './travel';
import { EngineBug } from './types';
import type { CommandT, Env, GameState, Session, Word } from './types';
import type { OutputEvent } from './events';

/* ---- Machine: everything one engine call needs ---- */

interface Machine {
  ctx: IoCtx;
  session: Session;
  env: Env;
  state: GameState;
  /** Set by croak(): the player died, so the caller must stop and wait. */
  stopped: boolean;
}

function makeMachine(state: GameState, env: Env): Machine {
  return {
    ctx: { game: state.game, events: [] },
    session: state.session,
    env,
    state,
    stopped: false,
  };
}

/** C: arbitrary_messages[i]. */
function msg(i: number): string | null {
  return ARBITRARY_MESSAGES[i] ?? null;
}

/** C: empty_command_word. */
function emptyWord(): Word {
  return { raw: '', id: WORD_EMPTY, type: NO_WORD_TYPE };
}

/** C: strncasecmp(raw, lit, sizeof(lit)) == 0 for an all-lowercase literal. */
function eqFold(raw: string, lit: string): boolean {
  return raw.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) === lit;
}

/* ---- describe_location, listobjects ---- */

/** C: describe_location (main.c). Describe the location to the user. */
function describeLocation(m: Machine): void {
  const { ctx, env } = m;
  const game = ctx.game;
  ctx.events.push({ type: 'room-entered', loc: game.loc });
  const loc = LOCATIONS[game.loc]!;
  let text = loc.small;

  if (game.locs[game.loc]!.abbrev % game.abbnum === 0 || text === null) {
    text = loc.big;
  }

  if (!forced(game.loc) && isDarkHere(game)) {
    text = msg(PITCH_DARK);
  }

  if (toting(game, BEAR)) {
    rspeak(ctx, TAME_BEAR);
  }

  speak(ctx, text);

  if (game.loc === LOC_Y2 && pct(game, 25, env) && !game.closng) {
    rspeak(ctx, SAYS_PLUGH);
  }
}

/**
 * C: listobjects (main.c). Print out descriptions of objects at this
 * location. If not closing and property value is negative, tally off another
 * treasure.
 */
function listObjects(ctx: IoCtx): void {
  const game = ctx.game;
  if (isDarkHere(game)) return;

  ++game.locs[game.loc]!.abbrev;
  for (let i = game.locs[game.loc]!.atloc; i !== 0; i = game.link[i]!) {
    let obj = i;
    if (obj >= NOBJECTS) {
      obj = obj - NOBJECTS;
    }
    if (obj === STEPS && toting(game, NUGGET)) {
      continue;
    }
    if (objectIsStashed(game, obj) || objectIsNotFound(game, obj)) {
      if (game.closed) {
        continue;
      }
      objectSetFound(game, obj);
      if (obj === RUG) {
        game.objects[RUG]!.prop = RUG_DRAGON;
      }
      if (obj === CHAIN) {
        game.objects[CHAIN]!.prop = CHAINING_BEAR;
      }
      if (obj === EGGS) {
        game.seenbigwords = true;
      }
      --game.tally;
    }
    let kk = game.objects[obj]!.prop;
    if (obj === STEPS) {
      kk = game.loc === game.objects[STEPS]!.fixed ? STEPS_UP : STEPS_DOWN;
    }
    pspeak(ctx, obj, 'look', true, kk);
  }
}

/* ---- lampcheck, closecheck ---- */

/** C: lampcheck (main.c). Check game limit and lamp timers. */
function lampcheck(ctx: IoCtx): void {
  const game = ctx.game;
  if (game.objects[LAMP]!.prop === LAMP_BRIGHT) {
    --game.limit;
  }

  /* When the lamp gets close to dying, warn him; if fresh batteries and the
   * lamp are here, replace them and continue. */
  if (game.limit <= WARNTIME) {
    if (
      isHere(game, BATTERY) &&
      game.objects[BATTERY]!.prop === FRESH_BATTERIES &&
      isHere(game, LAMP)
    ) {
      rspeak(ctx, REPLACE_BATTERIES);
      game.objects[BATTERY]!.prop = DEAD_BATTERIES;
      game.limit += BATTERYLIFE;
      game.lmwarn = false;
    } else if (!game.lmwarn && isHere(game, LAMP)) {
      game.lmwarn = true;
      if (game.objects[BATTERY]!.prop === DEAD_BATTERIES) {
        rspeak(ctx, MISSING_BATTERIES);
      } else if (game.objects[BATTERY]!.place === LOC_NOWHERE) {
        rspeak(ctx, LAMP_DIM);
      } else {
        rspeak(ctx, GET_BATTERIES);
      }
    }
  }
  if (game.limit === 0) {
    game.limit = -1;
    game.objects[LAMP]!.prop = LAMP_DARK;
    if (isHere(game, LAMP)) {
      rspeak(ctx, LAMP_OUT);
    }
  }
}

/**
 * C: closecheck (main.c). Handle the closing of the cave. Returns true when
 * the cave is closed (do_command then returns).
 */
function closecheck(ctx: IoCtx): boolean {
  const game = ctx.game;

  /* If a turn threshold has been met, apply penalties and tell the player. */
  for (let i = 0; i < NTHRESHOLDS; ++i) {
    const t = TURN_THRESHOLDS[i]!;
    if (game.turns === t.threshold + 1) {
      game.trnluz += t.pointLoss;
      speak(ctx, t.message);
    }
  }

  /* Don't tick game.clock1 unless well into cave (and not at Y2). */
  if (game.tally === 0 && indeep(game.loc) && game.loc !== LOC_Y2) {
    --game.clock1;
  }

  /* When the first warning comes, we lock the grate, destroy the bridge,
   * kill all the dwarves (and the pirate), remove the troll and bear (unless
   * dead), and set "closng" to true. */
  if (game.clock1 === 0) {
    game.objects[GRATE]!.prop = GRATE_CLOSED;
    game.objects[FISSURE]!.prop = UNBRIDGED;
    for (let i = 1; i <= NDWARVES; i++) {
      game.dwarves[i]!.seen = false;
      game.dwarves[i]!.loc = LOC_NOWHERE;
    }
    destroy(game, TROLL);
    move(game, TROLL + NOBJECTS, IS_FREE);
    move(game, TROLL2, OBJECTS[TROLL]!.plac);
    move(game, TROLL2 + NOBJECTS, OBJECTS[TROLL]!.fixd);
    juggle(game, CHASM);
    if (game.objects[BEAR]!.prop !== BEAR_DEAD) {
      destroy(game, BEAR);
    }
    game.objects[CHAIN]!.prop = CHAIN_HEAP;
    game.objects[CHAIN]!.fixed = IS_FREE;
    game.objects[AXE]!.prop = AXE_HERE;
    game.objects[AXE]!.fixed = IS_FREE;
    rspeak(ctx, CAVE_CLOSING);
    game.clock1 = -1;
    game.closng = true;
    return game.closed;
  } else if (game.clock1 < 0) {
    --game.clock2;
  }
  if (game.clock2 === 0) {
    /* Once he's panicked, and clock2 has run out, we come here to set up the
     * storage room (LOC_NE and LOC_SW). */
    put(game, BOTTLE, LOC_NE, EMPTY_BOTTLE);
    put(game, PLANT, LOC_NE, PLANT_THIRSTY);
    put(game, OYSTER, LOC_NE, 0); // STATE_FOUND
    put(game, LAMP, LOC_NE, LAMP_DARK);
    put(game, ROD, LOC_NE, 0);
    put(game, DWARF, LOC_NE, 0);
    game.loc = LOC_NE;
    game.oldloc = LOC_NE;
    game.newloc = LOC_NE;
    /* Leave the grate with normal (non-negative) property. Reuse sign. */
    move(game, GRATE, LOC_SW);
    move(game, SIGN, LOC_SW);
    game.objects[SIGN]!.prop = ENDGAME_SIGN;
    put(game, SNAKE, LOC_SW, SNAKE_CHASED);
    put(game, BIRD, LOC_SW, BIRD_CAGED);
    put(game, CAGE, LOC_SW, 0);
    put(game, ROD2, LOC_SW, 0);
    put(game, PILLOW, LOC_SW, 0);

    put(game, MIRROR, LOC_NE, 0);
    game.objects[MIRROR]!.fixed = LOC_SW;

    for (let i = 1; i < NOBJECTS; i++) {
      if (toting(game, i)) {
        destroy(game, i);
      }
    }

    rspeak(ctx, CAVE_CLOSED);
    game.closed = true;
    return game.closed;
  }

  lampcheck(ctx);
  return false;
}

/* ---- checkhints ---- */

/**
 * C: checkhints (main.c), the per-hint `switch`. Returns true when the hint
 * should be offered ("break" in C) and false when checkhints returns.
 */
function hintReady(ctx: IoCtx, hint: number): boolean {
  const game = ctx.game;
  const h = game.hints[hint]!;
  const noneAt = (loc: number): boolean => game.locs[loc]!.atloc === NO_OBJECT;
  switch (hint) {
    case 0: /* cave */
      if (game.objects[GRATE]!.prop === GRATE_CLOSED && !isHere(game, KEYS)) {
        return true;
      }
      h.lc = 0;
      return false;
    case 1: /* bird */
      return (
        game.objects[BIRD]!.place === game.loc &&
        toting(game, ROD) &&
        game.oldobj === BIRD
      );
    case 2: /* snake */
      if (isHere(game, SNAKE) && !isHere(game, BIRD)) return true;
      h.lc = 0;
      return false;
    case 3: /* maze */
      if (noneAt(game.loc) && noneAt(game.oldloc) && noneAt(game.oldlc2) && game.holdng > 1) {
        return true;
      }
      h.lc = 0;
      return false;
    case 4: /* dark */
      if (!objectIsNotFound(game, EMERALD) && objectIsNotFound(game, PYRAMID)) {
        return true;
      }
      h.lc = 0;
      return false;
    case 5: /* witt */
      return true;
    case 6: /* urn */
      if (game.dflag === 0) return true;
      h.lc = 0;
      return false;
    case 7: /* woods */
      return noneAt(game.loc) && noneAt(game.oldloc) && noneAt(game.oldlc2);
    case 8: {
      /* ogre */
      const i = atdwrf(game, game.loc);
      if (i < 0) {
        h.lc = 0;
        return false;
      }
      return isHere(game, OGRE) && i === 0;
    }
    case 9: /* jade */
      if (
        game.tally === 1 &&
        (objectIsStashed(game, JADE) || objectIsNotFound(game, JADE))
      ) {
        return true;
      }
      h.lc = 0;
      return false;
    default:
      // C: BUG(HINT_NUMBER_EXCEEDS_GOTO_LIST)
      throw new EngineBug('HINT_NUMBER_EXCEEDS_GOTO_LIST');
  }
}

/**
 * C: checkhints (main.c), the loop over hints starting at `from`. Returns
 * true when it blocked on a hint question (the Pending tag is set).
 */
function hintLoop(m: Machine, from: number): boolean {
  const { ctx, session } = m;
  const game = ctx.game;
  for (let hint = from; hint < NHINTS; hint++) {
    const h = game.hints[hint]!;
    if (h.used) continue;
    if (!cndbit(game.loc, hint + 1 + COND_HBASE)) {
      h.lc = -1;
    }
    ++h.lc;
    /* Come here if he's been in long enough at required loc(s) for some
     * unused hint. */
    if (h.lc >= HINTS[hint]!.turns) {
      if (!hintReady(ctx, hint)) return false;
      /* Fall through to hint display */
      h.lc = 0;
      askYesNo(ctx, session.settings, HINTS[hint]!.question);
      session.pending = { k: 'hint-question', hint };
      return true;
    }
  }
  return false;
}

/* ---- croak ---- */

type CroakOrigin = 'dwarf' | 'nowhere' | 'pit' | 'bridge';

/**
 * C: croak (main.c), first half: the player is dead. Closing time ends the
 * game; otherwise the reincarnation question is asked (Pending `croak`).
 * Either way the caller must stop and wait (`m.stopped`).
 */
function croakBegin(m: Machine, origin: CroakOrigin): void {
  const { ctx, session } = m;
  const game = ctx.game;
  m.stopped = true;

  /* Okay, he's dead. Let's get on with it. */
  const obit = game.numdie;
  ++game.numdie;
  ctx.events.push({ type: 'death', cause: origin, count: game.numdie });

  if (game.closng) {
    /* He died during closing time. No resurrection. Tally up a death and exit. */
    rspeak(ctx, DEATH_CLOSING);
    terminate(ctx, session, 'endgame');
    return;
  }
  const o = OBITUARIES[obit];
  if (o === undefined) {
    throw new EngineBug('OBITUARY_INDEX_OUT_OF_RANGE');
  }
  ctx.events.push({ type: 'reincarnation-offered', obituary: obit });
  askYesNo(ctx, session.settings, o.query);
  session.pending = { k: 'croak', origin, obit };
}

/** C: croak (main.c), the reincarnation branch. */
function reincarnate(ctx: IoCtx): void {
  const game = ctx.game;
  /* If player wishes to continue, we empty the liquids in the user's
   * inventory, turn off the lamp, and drop all items where he died. */
  game.objects[WATER]!.place = LOC_NOWHERE;
  game.objects[OIL]!.place = LOC_NOWHERE;
  if (toting(game, LAMP)) {
    game.objects[LAMP]!.prop = LAMP_DARK;
  }
  for (let j = 1; j < NOBJECTS; j++) {
    const i = NOBJECTS - j;
    if (toting(game, i)) {
      /* Always leave lamp where it's accessible aboveground */
      drop(game, i, i === LAMP ? LOC_START : game.oldlc2);
    }
  }
  game.oldloc = game.loc = game.newloc = LOC_BUILDING;
}

/* ---- do_move ---- */

type MoveStage = 'a' | 'b' | 'c';
type MoveResult = 'stop' | 'yes' | 'no';

/**
 * C: do_move (main.c). Actually execute the move to the new location and
 * dwarf movement. Stage 'a' is the top; 'b' continues after the first croak
 * (dwarf); 'c' continues after the second (loc == LOC_NOWHERE). Returns 'no'
 * for C's `false` (the main loop calls do_move again), 'stop' when blocked
 * or over.
 */
function doMove(m: Machine, stageIn: MoveStage): MoveResult {
  const { ctx, env } = m;
  const game = ctx.game;
  let stage = stageIn;

  if (stage === 'a') {
    /* Can't leave cave once it's closing (except by main office). */
    if (outside(game.newloc) && game.newloc !== 0 && game.closng) {
      rspeak(ctx, EXIT_CLOSED);
      game.newloc = game.loc;
      if (!game.panic) {
        game.clock2 = PANICTIME;
      }
      game.panic = true;
    }

    /* See if a dwarf has seen him and has come from where he wants to go. */
    if (game.newloc !== game.loc && !forced(game.loc) && !cndbit(game.loc, COND_NOARRR)) {
      for (let i = 1; i <= NDWARVES - 1; i++) {
        if (game.dwarves[i]!.oldloc === game.newloc && game.dwarves[i]!.seen) {
          game.newloc = game.loc;
          rspeak(ctx, DWARF_BLOCK);
          break;
        }
      }
    }
    game.loc = game.newloc;

    if (!dwarfmove(ctx, env)) {
      croakBegin(m, 'dwarf');
      return 'stop';
    }
    stage = 'b';
  }

  if (stage === 'b') {
    if (game.loc === LOC_NOWHERE) {
      croakBegin(m, 'nowhere');
      return 'stop';
    }
    stage = 'c';
  }

  /* The easiest way to get killed is to fall into a pit in pitch darkness. */
  if (
    !forced(game.loc) &&
    isDarkHere(game) &&
    game.wzdark &&
    pct(game, PIT_KILL_PROB, env)
  ) {
    rspeak(ctx, PIT_FALL);
    game.oldlc2 = game.loc;
    croakBegin(m, 'pit');
    return 'stop';
  }
  return 'yes';
}

/* ---- do_command ---- */

/**
 * Stages of the do_command stage machine (design: S1 to S5).
 *  start: initial clear_command        outer: while (state != EXECUTED)
 *  S1: describe the location           mid:   while (state <= GIVEN), S2 work
 *  S3: pre-process loop (hints)        S3b:   block for command input
 *  S4: closecheck                      S5:    while (state == PREPROCESSED)
 */
type CmdStage = 'start' | 'outer' | 'S1' | 'mid' | 'S3' | 'S3b' | 'S4' | 'S5';
type CmdResult = 'stop' | 'done';

/** The "go back to do_command's phase" part of C: switch (action(command)). */
function applyPhase(m: Machine, code: number): void {
  const { ctx, session, env } = m;
  const cmd = session.cmd;
  switch (code) {
    case GO_TERMINATE:
      cmd.state = CMD_EXECUTED;
      break;
    case GO_MOVE:
      playermove(ctx, NUL, () => croakBegin(m, 'bridge'), env);
      cmd.state = CMD_EXECUTED;
      break;
    case GO_WORD2:
      /* Get second word for analysis. */
      cmd.word[0] = cmd.word[1];
      cmd.word[1] = emptyWord();
      cmd.state = CMD_PREPROCESSED;
      break;
    case GO_UNKNOWN: {
      /* Random intransitive verbs come here. Clear obj just in case (see
       * attack()). */
      const w = cmd.word[0];
      const raw = w.raw.length > 0 ? w.raw[0]!.replace(/[a-z]/, (c) => c.toUpperCase()) + w.raw.slice(1) : w.raw;
      cmd.word[0] = { raw, id: w.id, type: w.type };
      sspeak(ctx, DO_WHAT, raw);
      cmd.obj = NO_OBJECT;
      /* object cleared; we need to go back to the preprocessing step */
      cmd.state = CMD_GIVEN;
      break;
    }
    case GO_CHECKHINT:
      cmd.state = CMD_GIVEN;
      break;
    case GO_DWARFWAKE:
      /* Oh dear, he's disturbed the dwarves. */
      rspeak(ctx, DWARVES_AWAKEN);
      terminate(ctx, session, 'endgame');
      break;
    case GO_CLEAROBJ:
      clearCommand(ctx, cmd);
      break;
    case GO_TOP:
      break;
    default:
      // C: BUG(ACTION_RETURNED_PHASE_CODE_BEYOND_END_OF_SWITCH)
      throw new EngineBug('ACTION_RETURNED_PHASE_CODE_BEYOND_END_OF_SWITCH');
  }
}

/** One pass of the `while (command.state == PREPROCESSED)` body. */
function processOne(m: Machine): CmdResult | 'cont' {
  const { ctx, session, env } = m;
  const game = ctx.game;
  const cmd = session.cmd;

  cmd.state = CMD_PROCESSING;

  if (cmd.word[0].id === WORD_NOT_FOUND) {
    /* Gee, I don't understand. */
    sspeak(ctx, DONT_KNOW, cmd.word[0].raw);
    clearCommand(ctx, cmd);
    return 'cont';
  }

  /* Give user hints of shortcuts */
  if (eqFold(cmd.word[0].raw, 'west')) {
    if (++game.iwest === 10) {
      rspeak(ctx, W_IS_WEST);
    }
  }
  if (eqFold(cmd.word[0].raw, 'go') && cmd.word[1].id !== WORD_EMPTY) {
    if (++game.igo === 10) {
      rspeak(ctx, GO_UNNEEDED);
    }
  }

  const w0 = cmd.word[0];
  switch (w0.type) {
    case MOTION:
      if (w0.id === XYZZY || w0.id === PLUGH || w0.id === PLOVER) {
        ctx.events.push({
          type: 'magic-word-used',
          word: w0.id === XYZZY ? 'XYZZY' : w0.id === PLUGH ? 'PLUGH' : 'PLOVER',
        });
      }
      playermove(ctx, w0.id, () => croakBegin(m, 'bridge'), env);
      cmd.state = CMD_EXECUTED;
      return m.stopped ? 'stop' : 'cont';
    case OBJECT:
      cmd.part = 0; // unknown
      cmd.obj = w0.id;
      break;
    case ACTION:
      cmd.part = cmd.word[1].type === NUMERIC ? 2 : 1; // transitive : intransitive
      cmd.verb = w0.id;
      break;
    case NUMERIC:
      if (!session.settings.oldstyle) {
        sspeak(ctx, DONT_KNOW, w0.raw);
        clearCommand(ctx, cmd);
        return 'cont';
      }
      break;
    default:
      // C: BUG(VOCABULARY_TYPE_N_OVER_1000_NOT_BETWEEN_0_AND_3)
      throw new EngineBug('VOCABULARY_TYPE_N_OVER_1000_NOT_BETWEEN_0_AND_3');
  }

  const r = action(ctx, session, cmd, env);
  if (r === BLOCKED) return 'stop';
  return applyAndCheck(m, r);
}

/** applyPhase, then report whether the engine must stop (over or died). */
function applyAndCheck(m: Machine, code: number): CmdResult | 'cont' {
  applyPhase(m, code);
  return m.stopped || m.session.status === 'over' ? 'stop' : 'cont';
}

/**
 * C: do_command (main.c). Get and execute a command, as a stage machine.
 * Returns 'done' for C's `true` and 'stop' when blocked, over, or dead.
 */
function doCommand(m: Machine, stageIn: CmdStage): CmdResult {
  const { ctx, session, env } = m;
  const game = ctx.game;
  const cmd: CommandT = session.cmd;
  const state = (): number => cmd.state;
  let stage = stageIn;

  for (;;) {
    if (session.status === 'over') return 'stop';
    switch (stage) {
      case 'start':
        clearCommand(ctx, cmd);
        stage = 'outer';
        break;

      case 'outer':
        /* Describe the current location and (maybe) get next command. */
        if (state() === CMD_EXECUTED) return 'done';
        stage = 'S1';
        break;

      case 'S1':
        describeLocation(m);
        if (forced(game.loc)) {
          playermove(ctx, MOTION_HERE, () => croakBegin(m, 'bridge'), env);
          return m.stopped ? 'stop' : 'done';
        }
        listObjects(ctx);
        /* Command not yet given; keep getting commands from user until valid
         * command is both given and executed. */
        clearCommand(ctx, cmd);
        stage = 'mid';
        break;

      case 'mid':
        if (state() > CMD_GIVEN) {
          stage = 'outer';
          break;
        }
        if (game.closed) {
          /* If closing time, check for any stashed objects being toted and
           * unstash them. */
          if (
            (objectIsNotFound(game, OYSTER) || objectIsStashed(game, OYSTER)) &&
            toting(game, OYSTER)
          ) {
            pspeak(ctx, OYSTER, 'look', true, 1);
          }
          for (let i = 1; i < NOBJECTS; i++) {
            if (toting(game, i) && (objectIsNotFound(game, i) || objectIsStashed(game, i))) {
              objectStashify(game, i, game.objects[i]!.prop);
            }
          }
        }

        /* Check to see if the room is dark. */
        game.wzdark = isDarkHere(game);

        /* If the knife is not here it permanently disappears. */
        if (game.knfloc > LOC_NOWHERE && game.knfloc !== game.loc) {
          game.knfloc = LOC_NOWHERE;
        }
        stage = 'S3';
        break;

      case 'S3':
        if (state() >= CMD_PREPROCESSED) {
          stage = 'S4';
          break;
        }
        if (CONDITIONS_EFFECTIVE[game.loc]! >= game.conds && hintLoop(m, 0)) {
          return 'stop';
        }
        stage = 'S3b';
        break;

      case 'S3b':
        /* Get command input from user (get_command_input blocks). */
        beginInput(ctx, session.settings, 'command');
        session.pending = { k: 'command' };
        return 'stop';

      case 'S4':
        /* check if game is closed, and exit if it is */
        if (closecheck(ctx)) return 'done';
        stage = 'S5';
        break;

      case 'S5': {
        /* loop until all words in command are processed */
        if (state() !== CMD_PREPROCESSED) {
          stage = 'mid';
          break;
        }
        const r = processOne(m);
        if (r === 'stop') return 'stop';
        break;
      }
    }
  }
}

/* ---- main ---- */

type Entry = { t: 'move'; stage: MoveStage } | { t: 'cmd'; stage: CmdStage };

/**
 * C: main (main.c), the `for (;;)` loop: do_move, then do_command. Starts at
 * the given entry and runs until the engine blocks, dies or the game ends.
 */
function runMain(m: Machine, entry: Entry): void {
  let e: Entry = entry;
  for (;;) {
    if (m.session.status === 'over') return;
    if (e.t === 'move') {
      const r = doMove(m, e.stage);
      if (r === 'stop') return;
      e = r === 'no' ? { t: 'move', stage: 'a' } : { t: 'cmd', stage: 'start' };
    } else {
      const r = doCommand(m, e.stage);
      if (r === 'stop') return;
      e = { t: 'move', stage: 'a' };
    }
  }
}

/** Continue after a resumed handler returned (a phase code or BLOCKED). */
function finishAction(m: Machine, r: ActionResult): void {
  if (r === BLOCKED) return;
  /* restore/resume/suspend may have ended the game (GO_TOP): check first. */
  if (m.session.status === 'over') return;
  const c = applyAndCheck(m, r);
  if (c === 'stop') return;
  runMain(m, { t: 'cmd', stage: 'S5' });
}

/** Block for the command prompt (used after the hint flow completes). */
function afterHints(m: Machine): void {
  runMain(m, { t: 'cmd', stage: 'S3b' });
}

/** The game-over event for input that arrives after the game has ended. */
function postGame(m: Machine): void {
  const { ctx, session } = m;
  ctx.events.push({
    type: 'game-over',
    score: computeScore(ctx.game, 'scoregame').score,
    rank: null,
    reason: session.exitReason ?? 'endgame',
    already: true,
  });
}

/** C: exit(EXIT_SUCCESS) from inside a yes/no read at end of input. */
function exitOnEof(m: Machine): void {
  const { ctx, session } = m;
  session.status = 'over';
  session.exitReason = 'eof';
  ctx.events.push({
    type: 'game-over',
    score: computeScore(ctx.game, 'scoregame').score,
    rank: null,
    reason: 'eof',
    already: false,
  });
}

/**
 * C: main (main.c) start-up: initialise's "Initialising..." line (oldstyle),
 * then either restore from `restoreText` (-r) or ask the novice question.
 * Mutates `state`; returns the events produced.
 */
export function mainStart(
  state: GameState,
  env: Env,
  restoreText?: string,
): OutputEvent[] {
  const m = makeMachine(state, env);
  const { ctx, session } = m;
  if (session.settings.oldstyle) {
    ctx.events.push({
      type: 'text',
      channel: 'io',
      blank: false,
      template: null,
      text: 'Initialising...\n',
    });
  }
  if (restoreText === undefined) {
    askYesNo(ctx, session.settings, msg(WELCOME_YOU));
    session.pending = { k: 'novice' };
    return ctx.events;
  }
  restore(ctx, session, restoreText);
  if (session.status === 'over') return ctx.events;
  runMain(m, { t: 'move', stage: 'a' });
  return ctx.events;
}

/**
 * One line of player input. Dispatches on the Pending tag and re-enters the
 * ported control flow. Mutates `state`; returns the events produced.
 */
export function mainStep(state: GameState, line: string, env: Env): OutputEvent[] {
  const m = makeMachine(state, env);
  const { ctx, session } = m;
  const game = ctx.game;

  if (session.status === 'over') {
    postGame(m);
    return ctx.events;
  }

  const p = session.pending;
  let input: string;
  if (p.k === 'suspend-file' || p.k === 'resume-file') {
    /* File-name reads are raw: no echo, no comment skipping. */
    input = line;
  } else {
    const got = receiveInput(ctx, session.settings, line);
    if (got === null) return ctx.events; // '#' comment: ignored silently
    input = got;
  }

  switch (p.k) {
    case 'novice': {
      const ans = answerYesNo(
        ctx,
        session.settings,
        input,
        msg(WELCOME_YOU),
        msg(CAVE_NEARBY),
        msg(NO_MESSAGE),
      );
      if (ans === null) break;
      game.novice = ans;
      if (ans) game.limit = NOVICELIMIT;
      runMain(m, { t: 'move', stage: 'a' });
      break;
    }

    case 'command': {
      const cmd = session.cmd;
      if (!getCommandInput(ctx, session.settings, cmd, input)) {
        /* TWO_WORDS or an empty line: get_command_input reads again. */
        beginInput(ctx, session.settings, 'command');
        break;
      }
      /* Every input, check "foobar" flag. If zero, nothing's going on. If
       * pos, make neg. If neg, he skipped a word, so make it zero. */
      game.foobar = game.foobar > WORD_EMPTY ? -game.foobar : WORD_EMPTY;
      ++game.turns;
      preprocessCommand(ctx, cmd);
      runMain(m, { t: 'cmd', stage: 'S3' });
      break;
    }

    case 'hint-question': {
      const hint = HINTS[p.hint]!;
      const ans = answerYesNo(
        ctx,
        session.settings,
        input,
        hint.question,
        msg(NO_MESSAGE),
        msg(OK_MAN),
      );
      if (ans === null) break;
      if (!ans) {
        afterHints(m);
        break;
      }
      rspeak(ctx, HINT_COST, hint.penalty, hint.penalty);
      askYesNo(ctx, session.settings, msg(WANT_HINT));
      session.pending = { k: 'hint-confirm', hint: p.hint };
      break;
    }

    case 'hint-confirm': {
      const hint = HINTS[p.hint]!;
      const ans = answerYesNo(
        ctx,
        session.settings,
        input,
        msg(WANT_HINT),
        hint.hint,
        msg(OK_MAN),
      );
      if (ans === null) break;
      game.hints[p.hint]!.used = ans;
      if (ans && game.limit > WARNTIME) {
        game.limit += WARNTIME * hint.penalty;
      }
      if (hintLoop(m, p.hint + 1)) break;
      afterHints(m);
      break;
    }

    case 'croak': {
      const o = OBITUARIES[p.obit];
      if (o === undefined) throw new EngineBug('OBITUARY_INDEX_OUT_OF_RANGE');
      const ans = answerYesNo(ctx, session.settings, input, o.query, o.yesResponse, msg(OK_MAN));
      if (ans === null) break;
      if (!ans || game.numdie === NDEATHS) {
        /* Player is asked if he wants to try again. If not, or if he's
         * already used all of his lives, we end the game */
        terminate(ctx, session, 'endgame');
        break;
      }
      reincarnate(ctx);
      /* Continue where the C call to croak() returned. */
      const entry: Entry =
        p.origin === 'dwarf'
          ? { t: 'move', stage: 'b' }
          : p.origin === 'nowhere'
            ? { t: 'move', stage: 'c' }
            : { t: 'move', stage: 'a' }; // pit: do_move false; bridge: do_command true
      runMain(m, entry);
      break;
    }

    case 'dragon':
      finishAction(m, resumeDragon(ctx, session, input));
      break;
    case 'quit':
      finishAction(m, resumeQuit(ctx, session, input));
      break;
    case 'clue':
      finishAction(m, resumeClue(ctx, session, input));
      break;
    case 'suspend-confirm':
      finishAction(m, resumeSuspendConfirm(ctx, session, input));
      break;
    case 'resume-confirm':
      finishAction(m, resumeResumeConfirm(ctx, session, input));
      break;
    case 'suspend-file':
      finishAction(m, resumeSuspendFile(ctx, session, env.storage, input, state));
      break;
    case 'resume-file':
      finishAction(m, resumeResumeFile(ctx, session, env.storage, input));
      break;
  }
  return ctx.events;
}

/**
 * End of file on stdin. At the command prompt the C loop ends and
 * terminate(quitgame) prints the score; inside a yes/no read the program
 * exits silently; inside a file-name read the stage returns GO_TOP and play
 * continues to the next prompt (which then sees the same end of file).
 * Mutates `state`; returns the events produced.
 */
export function mainEndOfInput(state: GameState, env: Env): OutputEvent[] {
  const m = makeMachine(state, env);
  const { ctx, session } = m;

  while (session.status !== 'over') {
    const p = session.pending;
    if (p.k === 'suspend-file' || p.k === 'resume-file') {
      finishAction(m, eofFileNameStage(ctx));
    } else if (p.k === 'command') {
      eofInput(ctx, session.settings);
      terminate(ctx, session, 'quitgame');
    } else {
      eofInput(ctx, session.settings);
      exitOnEof(m);
    }
  }
  return ctx.events;
}
