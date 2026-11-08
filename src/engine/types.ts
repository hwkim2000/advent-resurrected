/*
 * Core engine types for the Open Adventure TypeScript port.
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

import type { OutputEvent } from './events';

/** C: struct game_t (advent.h). All fields are JSON-safe. */
export interface Game {
  lcg_x: number;
  abbnum: number; // How often to print long descriptions
  bonus: 0 | 1 | 2 | 3; // C: score_t - none, splatter, defeat, victory
  chloc: number; // pirate chest location
  chloc2: number; // pirate chest alternate location
  clock1: number; // turns from finding last treasure to close
  clock2: number; // turns from warning till blinding flash
  clshnt: boolean; // has player read the clue in the endgame?
  closed: boolean; // whether we're all the way closed
  closng: boolean; // whether it's closing time yet
  lmwarn: boolean; // has player been warned about lamp going dim?
  novice: boolean; // asked for instructions at start-up?
  panic: boolean; // has player found out he's trapped?
  wzdark: boolean; // whether the loc he's leaving was dark
  blooded: boolean; // has player drunk of dragon's blood?
  conds: number; // min value for cond[loc] if loc has any hints
  detail: number; // level of detail in descriptions
  dflag: number; // level of activation of dwarves
  dkill: number; // dwarves killed
  dtotal: number; // total dwarves (including pirate) in loc
  foobar: number; // progress in saying "FEE FIE FOE FOO"
  holdng: number; // number of objects being carried
  igo: number; // uses of "go" instead of a direction
  iwest: number; // times he's said "west" instead of "w"
  knfloc: number; // knife location; LOC_NOWHERE if none, -1 after caveat
  limit: number; // lifetime of lamp
  loc: number; // where player is now
  newloc: number; // where player is going
  numdie: number; // number of times killed so far
  oldloc: number; // where player was
  oldlc2: number; // where player was two moves ago
  oldobj: number; // last object player handled
  saved: number; // point penalty for saves
  tally: number; // count of treasures gained
  thresh: number; // current threshold for endgame scoring tier
  seenbigwords: boolean; // have we read the graffiti in the Giant's Room?
  trnluz: number; // points lost so far due to turns used
  turns: number; // counts commands given (ignores yes/no)
  zzword: string; // TOKLEN chars; randomly generated magic word from bird
  locs: { abbrev: number; atloc: number }[]; // NLOCATIONS
  dwarves: { seen: boolean; loc: number; oldloc: number }[]; // NDWARVES + 1
  objects: { fixed: number; prop: number; place: number }[]; // NOBJECTS
  hints: { used: boolean; lc: number }[]; // NHINTS
  link: number[]; // NOBJECTS * 2
}

/** C: word_type_t (advent.h): NO_WORD_TYPE, MOTION, OBJECT, ACTION, NUMERIC. */
export type WordType = 0 | 1 | 2 | 3 | 4;

/** C: command_word_t. */
export interface Word {
  raw: string;
  id: number;
  type: WordType;
}

/** C: command_t. `state` runs EMPTY..EXECUTED (0..6). */
export interface CommandT {
  part: 0 | 1 | 2; // C: speechpart - unknown, intransitive, transitive
  verb: number;
  obj: number;
  state: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  word: [Word, Word];
}

/** Settings are not part of the C save format (C: struct settings_t). */
export interface Settings {
  oldstyle: boolean;
  prompt: boolean;
}

/**
 * Where the engine is blocked waiting for input. Replaces the C call stack
 * (every blocking point in the C program becomes one tag).
 */
export type Pending =
  | { k: 'novice' }
  | { k: 'command' }
  | { k: 'hint-question'; hint: number }
  | { k: 'hint-confirm'; hint: number }
  | { k: 'croak'; origin: 'dwarf' | 'nowhere' | 'pit' | 'bridge'; obit: number }
  | { k: 'dragon' }
  | { k: 'quit' }
  | { k: 'clue' }
  | { k: 'suspend-confirm' }
  | { k: 'suspend-file' }
  | { k: 'resume-confirm' }
  | { k: 'resume-file' };

export type SessionStatus = 'running' | 'over';

export type ExitReason =
  | null
  | 'quit'
  | 'endgame'
  | 'suspended'
  | 'tampered'
  | 'eof';

/** Everything the C program keeps outside `struct game_t`. */
export interface Session {
  settings: Settings;
  cmd: CommandT; // C: `static command_t command` in do_command
  pending: Pending;
  status: SessionStatus;
  exitReason: ExitReason;
  reportedLimit: number; // for lamp-level events
  reportedScore: number; // for score events
}

export interface GameState {
  game: Game;
  session: Session;
}

/** Options accepted by newGame (the -o switch of the C program). */
export interface GameOptions {
  oldstyle?: boolean;
}

/** One engine step: the new state plus the ordered events it produced. */
export interface StepResult {
  state: GameState;
  events: OutputEvent[];
}

/** Synchronous, injected storage for SAVE/RESUME (no file system in the engine). */
export interface Storage {
  /** Returns the stored text, or undefined when the file cannot be opened. */
  read(name: string): string | undefined;
  /** Returns false when the file cannot be opened for writing. */
  write(name: string, data: string): boolean;
}

/** Injected environment for start/step/endOfInput. */
export interface Env {
  storage: Storage;
  /** Test-only hook that records each RNG draw. Does not change behavior. */
  rngTrace?: (value: number) => void;
}

/** C: bug() - an internal consistency failure in the port. */
export class EngineBug extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineBug';
  }
}
