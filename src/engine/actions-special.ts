/*
 * Action handlers that block on input or end the game, ported to TypeScript:
 * attack (bare-hands dragon question), quit, read (oyster clue), bigwords
 * (magic words), blast, and the suspend/resume entry points.
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
 * Blocking model: a handler that must wait for the player sets
 * `session.pending`, emits the question and returns BLOCKED. The matching
 * `resume*` function is called by the main loop with the (already echoed)
 * reply line and returns the phase code the C handler would have returned.
 *
 * The file-name stages of SAVE/RESUME (pendings `suspend-file` and
 * `resume-file`) are continued by save-resume.ts (task 8.6).
 */

import {
  BARE_HANDS_QUERY,
  BEAR,
  BEAR_CONFUSED,
  BEAR_DEAD,
  BEAR_HANDS,
  BIRD,
  BIRD_DEAD,
  BLOOD,
  CLAM,
  CLUE_QUERY,
  CONTENTED_BEAR,
  DEFEAT_MESSAGE,
  DONT_UNDERSTAND,
  DRAGON,
  DRAGON_BARS,
  DRAGON_DEAD,
  DWARF,
  EGGS,
  EGGS_DONE,
  EGGS_HERE,
  EGGS_VANISHED,
  FEE,
  FIE,
  FOE,
  FOO,
  FUM,
  KNIFE_THROWN,
  LOC_LONGWEST,
  LOC_NE,
  LOC_NOWHERE,
  LOC_SECRET5,
  LOC_START,
  NASTY_DRAGON,
  NDWARVES,
  NOBJECTS,
  NOTHING_HAPPENS,
  NO_OBJECT,
  NO_SEE,
  NO_TARGET,
  OGRE,
  OGRE_DODGE,
  OGRE_PANIC1,
  OGRE_PANIC2,
  OK_MAN,
  OYSTER,
  REALLY_QUIT,
  REQUIRES_DYNAMITE,
  RESUME_ABANDON,
  ROCKY_TROLL,
  ROD2,
  RUG,
  RUG_FLOOR,
  SHELL_IMPERVIOUS,
  SITTING_BEAR,
  SNAKE,
  SNAKE_WARNING,
  SPLATTER_MESSAGE,
  START_OVER,
  SUSPEND_WARNING,
  THIS_ACCEPTABLE,
  THROW,
  TROLL,
  TROLL_PAIDONCE,
  TROLL_UNPAID,
  UNHAPPY_BIRD,
  UNTAMED_BEAR,
  VEND,
  VEND_BLOCKS,
  VEND_UNBLOCKS,
  VICTORY_MESSAGE,
  WAYOUT_CLUE,
  WELL_POINTLESS,
  ALREADY_DEAD,
} from '../data/constants';
import { ACTIONS, ARBITRARY_MESSAGES, OBJECTS } from '../data/dungeon';
import {
  askSilentYesNo,
  askYesNo,
  answerSilentYesNo,
  answerYesNo,
  beginFileName,
  pspeak,
  rspeak,
  speak,
  sspeak,
} from './io';
import type { IoCtx } from './io';
import {
  IS_FIXED,
  IS_FREE,
  INTRANSITIVE,
  at,
  atdwrf,
  destroy,
  drop,
  isDarkHere,
  isHere,
  move,
  objectIsNotFound,
  objectIsStashed,
  stateChange,
  toting,
} from './objects';
import { terminate } from './score';
import type { CommandT, Session } from './types';

/* ---- C: phase_codes_t (advent.h) ---- */

export const GO_TERMINATE = 0;
export const GO_MOVE = 1;
export const GO_TOP = 2;
export const GO_CLEAROBJ = 3;
export const GO_CHECKHINT = 4;
export const GO_WORD2 = 5;
export const GO_UNKNOWN = 6;
export const GO_DWARFWAKE = 7;

/** C: phase_codes_t. */
export type PhaseCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Returned by a handler that has stored a Pending tag and is waiting for the
 * player. The handler's resume function continues at the C continuation.
 */
export const BLOCKED = 'blocked' as const;
export type Blocked = typeof BLOCKED;

/** Result of a handler: a phase code, or BLOCKED. */
export type ActionResult = PhaseCode | Blocked;

/** C: enum score_t values (advent.h): none, splatter, defeat, victory. */
const BONUS_SPLATTER = 1;
const BONUS_DEFEAT = 2;
const BONUS_VICTORY = 3;

/** C: actions[verb].message. */
function verbMessage(verb: number): string | null {
  return ACTIONS[verb]?.message ?? null;
}

/** C: arbitrary_messages[i]. */
function msg(i: number): string | null {
  return ARBITRARY_MESSAGES[i] ?? null;
}

/**
 * C: attack (actions.c). Attack. Assume target if unambiguous. "Throw" also
 * links here. Blocks (pending `dragon`) on the bare-hands dragon question.
 */
export function attack(
  ctx: IoCtx,
  session: Session,
  command: CommandT,
): ActionResult {
  const game = ctx.game;
  const verb = command.verb;
  let obj = command.obj;

  if (obj === INTRANSITIVE) {
    let changes = 0;
    if (atdwrf(game, game.loc) > 0) {
      obj = DWARF;
      ++changes;
    }
    if (isHere(game, SNAKE)) {
      obj = SNAKE;
      ++changes;
    }
    if (at(game, DRAGON) && game.objects[DRAGON]!.prop === DRAGON_BARS) {
      obj = DRAGON;
      ++changes;
    }
    if (at(game, TROLL)) {
      obj = TROLL;
      ++changes;
    }
    if (at(game, OGRE)) {
      obj = OGRE;
      ++changes;
    }
    if (isHere(game, BEAR) && game.objects[BEAR]!.prop === UNTAMED_BEAR) {
      obj = BEAR;
      ++changes;
    }
    /* check for low-priority targets */
    if (obj === INTRANSITIVE) {
      /* Can't attack bird or machine by throwing axe. */
      if (isHere(game, BIRD) && verb !== THROW) {
        obj = BIRD;
        ++changes;
      }
      if (isHere(game, VEND) && verb !== THROW) {
        obj = VEND;
        ++changes;
      }
      /* Clam and oyster both treated as clam for intransitive case; no harm
       * done. */
      if (isHere(game, CLAM) || isHere(game, OYSTER)) {
        obj = CLAM;
        ++changes;
      }
    }
    if (changes >= 2) {
      return GO_UNKNOWN;
    }
  }

  if (obj === BIRD) {
    if (game.closed) {
      rspeak(ctx, UNHAPPY_BIRD);
    } else {
      destroy(game, BIRD);
      rspeak(ctx, BIRD_DEAD);
    }
    return GO_CLEAROBJ;
  }
  if (obj === VEND) {
    stateChange(
      ctx,
      VEND,
      game.objects[VEND]!.prop === VEND_BLOCKS ? VEND_UNBLOCKS : VEND_BLOCKS,
    );
    return GO_CLEAROBJ;
  }

  if (obj === BEAR) {
    switch (game.objects[BEAR]!.prop) {
      case UNTAMED_BEAR:
        rspeak(ctx, BEAR_HANDS);
        break;
      case SITTING_BEAR:
        rspeak(ctx, BEAR_CONFUSED);
        break;
      case CONTENTED_BEAR:
        rspeak(ctx, BEAR_CONFUSED);
        break;
      case BEAR_DEAD:
        rspeak(ctx, ALREADY_DEAD);
        break;
    }
    return GO_CLEAROBJ;
  }
  if (obj === DRAGON && game.objects[DRAGON]!.prop === DRAGON_BARS) {
    /* Fun stuff for dragon. If he insists on attacking it, win! The
     * silent_yes_or_no continues in resumeDragon. */
    rspeak(ctx, BARE_HANDS_QUERY);
    askSilentYesNo(ctx, session.settings);
    session.pending = { k: 'dragon' };
    return BLOCKED;
  }

  if (obj === OGRE) {
    rspeak(ctx, OGRE_DODGE);
    if (atdwrf(game, game.loc) === 0) {
      return GO_CLEAROBJ;
    }
    rspeak(ctx, KNIFE_THROWN);
    destroy(game, OGRE);
    let dwarves = 0;
    for (let i = 1; i < NDWARVES; i++) {
      if (game.dwarves[i]!.loc === game.loc) {
        ++dwarves;
        game.dwarves[i]!.loc = LOC_LONGWEST;
        game.dwarves[i]!.seen = false;
      }
    }
    rspeak(ctx, dwarves > 1 ? OGRE_PANIC1 : OGRE_PANIC2);
    return GO_CLEAROBJ;
  }

  switch (obj) {
    case INTRANSITIVE:
      rspeak(ctx, NO_TARGET);
      break;
    case CLAM:
    case OYSTER:
      rspeak(ctx, SHELL_IMPERVIOUS);
      break;
    case SNAKE:
      rspeak(ctx, SNAKE_WARNING);
      break;
    case DWARF:
      if (game.closed) {
        return GO_DWARFWAKE;
      }
      rspeak(ctx, BARE_HANDS_QUERY);
      break;
    case DRAGON:
      rspeak(ctx, ALREADY_DEAD);
      break;
    case TROLL:
      rspeak(ctx, ROCKY_TROLL);
      break;
    default:
      speak(ctx, verbMessage(verb));
  }
  return GO_CLEAROBJ;
}

/**
 * C: attack (actions.c), continuation after silent_yes_or_no in the
 * bare-hands dragon case. Returns BLOCKED again on an invalid answer.
 */
export function resumeDragon(
  ctx: IoCtx,
  session: Session,
  reply: string,
): ActionResult {
  const game = ctx.game;
  const answer = answerSilentYesNo(ctx, session.settings, reply);
  if (answer === null) {
    return BLOCKED;
  }
  if (!answer) {
    speak(ctx, msg(NASTY_DRAGON));
    return GO_MOVE;
  }
  stateChange(ctx, DRAGON, DRAGON_DEAD);
  game.objects[RUG]!.prop = RUG_FLOOR;
  /* Hardcoding LOC_SECRET5 as the dragon's death location, as upstream does. */
  move(game, DRAGON + NOBJECTS, IS_FIXED);
  move(game, RUG + NOBJECTS, IS_FREE);
  move(game, DRAGON, LOC_SECRET5);
  move(game, RUG, LOC_SECRET5);
  drop(game, BLOOD, LOC_SECRET5);
  for (let i = 1; i < NOBJECTS; i++) {
    if (
      game.objects[i]!.place === OBJECTS[DRAGON]!.plac ||
      game.objects[i]!.place === OBJECTS[DRAGON]!.fixd
    ) {
      move(game, i, LOC_SECRET5);
    }
  }
  game.loc = LOC_SECRET5;
  return GO_MOVE;
}

/** Vocabulary names of the magic words handled by bigwords. */
const BIGWORD_NAMES: Readonly<Record<number, string>> = {
  [FEE]: 'FEE',
  [FIE]: 'FIE',
  [FOE]: 'FOE',
  [FOO]: 'FOO',
  [FUM]: 'FUM',
};

/**
 * C: bigwords (actions.c). Only called on FEE FIE FOE FOO (AND FUM). Advance
 * to next state if given in proper order. Last word zips the eggs back to the
 * giant room (unless already there). Emits `magic-word-used`.
 */
export function bigwords(
  ctx: IoCtx,
  session: Session,
  id: number,
): PhaseCode {
  const game = ctx.game;
  ctx.events.push({ type: 'magic-word-used', word: BIGWORD_NAMES[id] ?? String(id) });

  const foobar = Math.abs(game.foobar);

  /* Only FEE can start a magic-word sequence. */
  if (foobar === 0 && (id === FIE || id === FOE || id === FOO || id === FUM)) {
    rspeak(ctx, NOTHING_HAPPENS);
    return GO_CLEAROBJ;
  }

  if (
    (foobar === 0 && id === FEE) ||
    (foobar === FEE && id === FIE) ||
    (foobar === FIE && id === FOE) ||
    (foobar === FOE && id === FOO)
  ) {
    game.foobar = id;
    if (id !== FOO) {
      rspeak(ctx, OK_MAN);
      return GO_CLEAROBJ;
    }
    game.foobar = 0;
    const eggs = OBJECTS[EGGS]!;
    if (
      game.objects[EGGS]!.place === eggs.plac ||
      (toting(game, EGGS) && game.loc === eggs.plac)
    ) {
      rspeak(ctx, NOTHING_HAPPENS);
      return GO_CLEAROBJ;
    }
    /* Bring back troll if we steal the eggs back from him before crossing. */
    if (
      game.objects[EGGS]!.place === LOC_NOWHERE &&
      game.objects[TROLL]!.place === LOC_NOWHERE &&
      game.objects[TROLL]!.prop === TROLL_UNPAID
    ) {
      game.objects[TROLL]!.prop = TROLL_PAIDONCE;
    }
    if (isHere(game, EGGS)) {
      pspeak(ctx, EGGS, 'look', true, EGGS_VANISHED);
    } else if (game.loc === eggs.plac) {
      pspeak(ctx, EGGS, 'look', true, EGGS_HERE);
    } else {
      pspeak(ctx, EGGS, 'look', true, EGGS_DONE);
    }
    move(game, EGGS, eggs.plac);
    return GO_CLEAROBJ;
  }

  /* Magic-word sequence was started but is incorrect. */
  if (session.settings.oldstyle || game.seenbigwords) {
    rspeak(ctx, START_OVER);
  } else {
    rspeak(ctx, WELL_POINTLESS);
  }
  game.foobar = 0;
  return GO_CLEAROBJ;
}

/**
 * C: blast (actions.c). No effect unless you've got dynamite, which is a neat
 * trick! The caller returns GO_CLEAROBJ afterwards, as in C.
 */
export function blast(ctx: IoCtx, session: Session): void {
  const game = ctx.game;
  if (objectIsNotFound(game, ROD2) || !game.closed) {
    rspeak(ctx, REQUIRES_DYNAMITE);
  } else {
    if (isHere(game, ROD2)) {
      game.bonus = BONUS_SPLATTER;
      rspeak(ctx, SPLATTER_MESSAGE);
    } else if (game.loc === LOC_NE) {
      game.bonus = BONUS_DEFEAT;
      rspeak(ctx, DEFEAT_MESSAGE);
    } else {
      game.bonus = BONUS_VICTORY;
      rspeak(ctx, VICTORY_MESSAGE);
    }
    terminate(ctx, session, 'endgame');
  }
}

/**
 * C: quit (actions.c). Verify intent and exit if that's what he wants.
 * Blocks (pending `quit`) on the yes/no question.
 */
export function quit(ctx: IoCtx, session: Session): ActionResult {
  askYesNo(ctx, session.settings, msg(REALLY_QUIT));
  session.pending = { k: 'quit' };
  return BLOCKED;
}

/** C: quit (actions.c), continuation after yes_or_no. */
export function resumeQuit(
  ctx: IoCtx,
  session: Session,
  reply: string,
): ActionResult {
  const answer = answerYesNo(
    ctx,
    session.settings,
    reply,
    msg(REALLY_QUIT),
    msg(OK_MAN),
    msg(OK_MAN),
  );
  if (answer === null) {
    return BLOCKED;
  }
  if (answer) {
    terminate(ctx, session, 'quitgame');
  }
  return GO_CLEAROBJ;
}

/**
 * C: read (actions.c). Print stuff based on objtxt. Oyster (?) is a special
 * case that may block (pending `clue`) on the clue question.
 */
export function read(
  ctx: IoCtx,
  session: Session,
  command: CommandT,
): ActionResult {
  const game = ctx.game;
  let obj = command.obj;

  if (obj === INTRANSITIVE) {
    let matches = 0; // 0 none, 1 single, 2 ambiguous
    let resolved = NO_OBJECT;
    for (let i = 1; i < NOBJECTS; i++) {
      if (
        isHere(game, i) &&
        OBJECTS[i]!.texts?.[0] != null &&
        !objectIsStashed(game, i)
      ) {
        if (matches === 0) {
          matches = 1;
          resolved = i;
        } else if (matches === 1) {
          matches = 2;
        }
      }
    }
    if (matches !== 1 || isDarkHere(game)) {
      return GO_UNKNOWN;
    }
    obj = resolved;
  }

  if (isDarkHere(game)) {
    sspeak(ctx, NO_SEE, command.word[0].raw);
  } else if (obj === OYSTER) {
    if (!toting(game, OYSTER) || !game.closed) {
      rspeak(ctx, DONT_UNDERSTAND);
    } else if (!game.clshnt) {
      askYesNo(ctx, session.settings, msg(CLUE_QUERY));
      session.pending = { k: 'clue' };
      return BLOCKED;
    } else {
      pspeak(ctx, OYSTER, 'hear', true, 1); // Not really a sound, but oh well.
    }
  } else if (
    (OBJECTS[obj]?.texts?.[0] ?? null) === null ||
    objectIsNotFound(game, obj)
  ) {
    speak(ctx, verbMessage(command.verb));
  } else {
    pspeak(ctx, obj, 'study', true, game.objects[obj]!.prop);
  }
  return GO_CLEAROBJ;
}

/** C: read (actions.c), continuation after the oyster-clue yes_or_no. */
export function resumeClue(
  ctx: IoCtx,
  session: Session,
  reply: string,
): ActionResult {
  const answer = answerYesNo(
    ctx,
    session.settings,
    reply,
    msg(CLUE_QUERY),
    msg(WAYOUT_CLUE),
    msg(OK_MAN),
  );
  if (answer === null) {
    return BLOCKED;
  }
  ctx.game.clshnt = answer;
  return GO_CLEAROBJ;
}

/**
 * C: suspend (saveresume.c), first stage: warn, then ask THIS_ACCEPTABLE.
 * Blocks (pending `suspend-confirm`).
 */
export function suspend(ctx: IoCtx, session: Session): ActionResult {
  rspeak(ctx, SUSPEND_WARNING);
  askYesNo(ctx, session.settings, msg(THIS_ACCEPTABLE));
  session.pending = { k: 'suspend-confirm' };
  return BLOCKED;
}

/**
 * C: suspend (saveresume.c), continuation after the confirmation. On yes the
 * penalty is charged and the file-name read begins (pending `suspend-file`,
 * continued by save-resume.ts).
 */
export function resumeSuspendConfirm(
  ctx: IoCtx,
  session: Session,
  reply: string,
): ActionResult {
  const answer = answerYesNo(
    ctx,
    session.settings,
    reply,
    msg(THIS_ACCEPTABLE),
    msg(OK_MAN),
    msg(OK_MAN),
  );
  if (answer === null) {
    return BLOCKED;
  }
  if (!answer) {
    return GO_CLEAROBJ;
  }
  ctx.game.saved = ctx.game.saved + 5;
  beginFileName(ctx);
  session.pending = { k: 'suspend-file' };
  return BLOCKED;
}

/**
 * C: resume (saveresume.c), first stage. If the player has moved on from the
 * start, warn and confirm (pending `resume-confirm`); otherwise go straight to
 * the file-name read (pending `resume-file`, continued by save-resume.ts).
 */
export function resume(ctx: IoCtx, session: Session): ActionResult {
  const game = ctx.game;
  if (game.loc !== LOC_START || game.locs[LOC_START]!.abbrev !== 1) {
    rspeak(ctx, RESUME_ABANDON);
    askYesNo(ctx, session.settings, msg(THIS_ACCEPTABLE));
    session.pending = { k: 'resume-confirm' };
    return BLOCKED;
  }
  beginFileName(ctx);
  session.pending = { k: 'resume-file' };
  return BLOCKED;
}

/** C: resume (saveresume.c), continuation after the abandon confirmation. */
export function resumeResumeConfirm(
  ctx: IoCtx,
  session: Session,
  reply: string,
): ActionResult {
  const answer = answerYesNo(
    ctx,
    session.settings,
    reply,
    msg(THIS_ACCEPTABLE),
    msg(OK_MAN),
    msg(OK_MAN),
  );
  if (answer === null) {
    return BLOCKED;
  }
  if (!answer) {
    return GO_CLEAROBJ;
  }
  beginFileName(ctx);
  session.pending = { k: 'resume-file' };
  return BLOCKED;
}
