/*
 * Classic two-word parser for the Open Adventure TypeScript port.
 *
 * Ported from Open Adventure (https://gitlab.com/esr/open-adventure).
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
 * Matching is exact classic matching only: ASCII case folding, the first
 * TOKLEN characters. There is deliberately no fuzzy, phonetic, alias or
 * edit-distance logic here.
 */

import {
  ACT_NULL,
  BIRD,
  CAGE,
  CARRY,
  DEPRESSION,
  DOOR,
  ENTER,
  ENTRANCE,
  FEET_WET,
  GRATE,
  LOC_AWKWARD,
  LOC_BIRDCHAMBER,
  LOC_COBBLE,
  LOC_DEBRIS,
  LOC_PITTOP,
  LOC_SLIT,
  LOC_START,
  LOC_VALLEY,
  NO_OBJECT,
  OIL,
  PART,
  PLANT,
  POUR,
  STREAM,
  TWO_WORDS,
  WATER,
  WHERE_QUERY,
} from '../data/constants';
import { ACTIONS, IGNORE, MOTIONS, OBJECTS } from '../data/dungeon';
import { type IoCtx, rspeak } from './io';
import { isHere, at, liqloc, LINESIZE, TOKLEN, WORD_EMPTY, WORD_NOT_FOUND } from './objects';
import type { CommandT, Settings, Word, WordType } from './types';

/* C: enum { EMPTY, RAW, TOKENIZED, GIVEN, PREPROCESSED, PROCESSING, EXECUTED } (advent.h) */
export const CMD_EMPTY = 0;
export const CMD_RAW = 1;
export const CMD_TOKENIZED = 2;
export const CMD_GIVEN = 3;
export const CMD_PREPROCESSED = 4;
export const CMD_PROCESSING = 5;
export const CMD_EXECUTED = 6;

/* C: word_type_t (advent.h) */
export const NO_WORD_TYPE = 0;
export const MOTION = 1;
export const OBJECT = 2;
export const ACTION = 3;
export const NUMERIC = 4;

/** C: TRUNCLEN (misc.c), the oldstyle token truncation length. */
const TRUNCLEN = TOKLEN + TOKLEN;

/** C: isspace in the C locale. */
function isCSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';
}

/** ASCII-only tolower, as in the C locale. */
function foldChar(c: string): string {
  return c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c;
}

/** C: strncasecmp(a, b, n) == 0, with end-of-string acting as NUL. */
function strncaseeq(a: string, b: string, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const ca = i < a.length ? foldChar(a[i]!) : '\0';
    const cb = i < b.length ? foldChar(b[i]!) : '\0';
    if (ca !== cb) return false;
    if (ca === '\0') return true;
  }
  return true;
}

/** C: strcasecmp(a, b) == 0. */
function strcaseeq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (foldChar(a[i]!) !== foldChar(b[i]!)) return false;
  }
  return true;
}

/** C: word_count (misc.c). Words are split on space and tab only. */
export function wordCount(str: string): number {
  let count = 0;
  let inblanks = true;
  for (const ch of str) {
    const delim = ch === ' ' || ch === '\t';
    if (inblanks) {
      if (!delim) {
        ++count;
        inblanks = false;
      }
    } else if (delim) {
      inblanks = true;
    }
  }
  return count;
}

/** The oldstyle ignore test shared by the motion and action lookups. */
function passesIgnore(word: string, oldstyle: boolean): boolean {
  return word.length > 1 || !IGNORE.includes(word[0]!) || !oldstyle;
}

/** C: get_motion_vocab_id (misc.c). */
export function getMotionVocabId(word: string, oldstyle: boolean): number {
  for (let i = 0; i < MOTIONS.length; ++i) {
    for (const w of MOTIONS[i]!.words ?? []) {
      if (strncaseeq(word, w, TOKLEN) && passesIgnore(word, oldstyle)) return i;
    }
  }
  return WORD_NOT_FOUND;
}

/** C: get_object_vocab_id (misc.c). */
export function getObjectVocabId(word: string): number {
  for (let i = 0; i < OBJECTS.length; ++i) {
    for (const w of OBJECTS[i]!.words ?? []) {
      if (strncaseeq(word, w, TOKLEN)) return i;
    }
  }
  return WORD_NOT_FOUND;
}

/** C: get_action_vocab_id (misc.c). */
export function getActionVocabId(word: string, oldstyle: boolean): number {
  for (let i = 0; i < ACTIONS.length; ++i) {
    for (const w of ACTIONS[i]!.words ?? []) {
      if (strncaseeq(word, w, TOKLEN) && passesIgnore(word, oldstyle)) return i;
    }
  }
  return WORD_NOT_FOUND;
}

/** C: is_valid_int (misc.c). */
function isValidInt(str: string): boolean {
  let i = 0;
  if (str[0] === '-') i = 1;
  if (i >= str.length) return false;
  for (; i < str.length; i++) {
    const c = str[i]!;
    if (c < '0' || c > '9') return false;
  }
  return true;
}

/** C: get_vocab_metadata (misc.c). Lookup order: motion, object, action, zzword, integer. */
export function getVocabMetadata(
  word: string,
  zzword: string,
  oldstyle: boolean,
): { id: number; type: WordType } {
  if (word === '') return { id: WORD_EMPTY, type: NO_WORD_TYPE };

  let ref = getMotionVocabId(word, oldstyle);
  if (ref !== WORD_NOT_FOUND) return { id: ref, type: MOTION };

  ref = getObjectVocabId(word);
  if (ref !== WORD_NOT_FOUND) return { id: ref, type: OBJECT };

  ref = getActionVocabId(word, oldstyle);
  if (ref !== WORD_NOT_FOUND && ref !== PART) return { id: ref, type: ACTION };

  // The reservoir magic word.
  if (strcaseeq(word, zzword)) return { id: PART, type: ACTION };

  if (isValidInt(word)) return { id: WORD_EMPTY, type: NUMERIC };

  return { id: WORD_NOT_FOUND, type: NO_WORD_TYPE };
}

/** C: sscanf(raw, "%s%s", ...): up to two C-isspace-delimited tokens. */
function scanTwoWords(raw: string): [string, string] {
  const out: string[] = [];
  let i = 0;
  while (out.length < 2) {
    while (i < raw.length && isCSpace(raw[i]!)) i++;
    if (i >= raw.length) break;
    const start = i;
    while (i < raw.length && !isCSpace(raw[i]!)) i++;
    out.push(raw.slice(start, i));
  }
  return [out[0] ?? '', out[1] ?? ''];
}

/** C: toupper in the C locale (ASCII only). */
function upperAscii(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
}

/**
 * C: tokenize (misc.c). The speech part and verb from the previous turn are
 * left alone; only the two words and the state are rewritten.
 */
export function tokenize(
  raw: string,
  cmd: CommandT,
  zzword: string,
  settings: Settings,
): void {
  let [w0, w1] = scanTwoWords(raw);

  // oldstyle: simulate the sixbit packing - truncate to 10 and uppercase.
  if (settings.oldstyle) {
    w0 = upperAscii(w0.slice(0, TRUNCLEN));
    w1 = upperAscii(w1.slice(0, TRUNCLEN));
  }

  const m0 = getVocabMetadata(w0, zzword, settings.oldstyle);
  const m1 = getVocabMetadata(w1, zzword, settings.oldstyle);
  cmd.word[0] = { raw: w0, id: m0.id, type: m0.type };
  cmd.word[1] = { raw: w1, id: m1.id, type: m1.type };
  cmd.state = CMD_TOKENIZED;
}

/**
 * C: get_command_input (misc.c), the part after a line has been read by
 * get_input. Returns true when a command was given (state GIVEN). Returns
 * false when the C loop would read another line: after TWO_WORDS has been
 * spoken, or after an empty line (silent). The caller must then block for
 * input again.
 */
export function getCommandInput(
  ctx: IoCtx,
  settings: Settings,
  cmd: CommandT,
  line: string,
): boolean {
  // A C string ends at the first NUL.
  const nul = line.indexOf('\0');
  const input = nul >= 0 ? line.slice(0, nul) : line;

  if (wordCount(input) > 2) {
    rspeak(ctx, TWO_WORDS);
    return false;
  }
  if (input === '') return false;

  // strncpy(inputbuf, input, LINESIZE - 1)
  const inputbuf = input.slice(0, LINESIZE - 1);
  tokenize(inputbuf, cmd, ctx.game.zzword, settings);
  cmd.state = CMD_GIVEN;
  return true;
}

/** C: clear_command (misc.c). Resets the command to empty. */
export function clearCommand(ctx: IoCtx, cmd: CommandT): void {
  cmd.verb = ACT_NULL;
  cmd.part = 0; // unknown
  ctx.game.oldobj = cmd.obj;
  cmd.obj = NO_OBJECT;
  cmd.state = CMD_EMPTY;
}

/**
 * C: preprocess_command (main.c). Rewrites object-verb forms and a few
 * special phrases. Returns true if pre-processing is complete and the command
 * is ready for primary processing.
 */
export function preprocessCommand(ctx: IoCtx, cmd: CommandT): boolean {
  const game = ctx.game;
  if (
    cmd.word[0].type === MOTION &&
    cmd.word[0].id === ENTER &&
    (cmd.word[1].id === STREAM || cmd.word[1].id === WATER)
  ) {
    if (liqloc(game.loc) === WATER) {
      rspeak(ctx, FEET_WET);
    } else {
      rspeak(ctx, WHERE_QUERY);
    }
    return false;
  }

  if (cmd.word[0].type === OBJECT) {
    // From OV to VO form.
    if (cmd.word[1].type === ACTION) {
      const stage: Word = cmd.word[0];
      cmd.word[0] = cmd.word[1];
      cmd.word[1] = stage;
    }

    if (cmd.word[0].id === GRATE) {
      cmd.word[0].type = MOTION;
      if (game.loc === LOC_START || game.loc === LOC_VALLEY || game.loc === LOC_SLIT) {
        cmd.word[0].id = DEPRESSION;
      }
      if (
        game.loc === LOC_COBBLE ||
        game.loc === LOC_DEBRIS ||
        game.loc === LOC_AWKWARD ||
        game.loc === LOC_BIRDCHAMBER ||
        game.loc === LOC_PITTOP
      ) {
        cmd.word[0].id = ENTRANCE;
      }
    }
    if (
      (cmd.word[0].id === WATER || cmd.word[0].id === OIL) &&
      (cmd.word[1].id === PLANT || cmd.word[1].id === DOOR)
    ) {
      if (at(game, cmd.word[1].id)) {
        cmd.word[1] = cmd.word[0];
        cmd.word[0] = { raw: 'pour', id: POUR, type: ACTION };
      }
    }
    if (
      cmd.word[0].id === CAGE &&
      cmd.word[1].id === BIRD &&
      isHere(game, CAGE) &&
      isHere(game, BIRD)
    ) {
      cmd.word[0].id = CARRY;
      cmd.word[0].type = ACTION;
    }
  }

  // If no word type is given for the first word, we assume it's a motion.
  if (cmd.word[0].type === NO_WORD_TYPE) {
    cmd.word[0].type = MOTION;
  }

  cmd.state = CMD_PREPROCESSED;
  return true;
}
