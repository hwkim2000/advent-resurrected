/*
 * Saving and resuming, ported to TypeScript: savefile, suspend, resume,
 * restore and is_valid, against a JSON Save_Document.
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
 * The C program writes a raw struct and calls exit(). Here the document is
 * JSON, all file access goes through the injected Storage, and every exit()
 * becomes `session.status = 'over'` plus a `game-over` event.
 *
 * The suspend-confirm and resume-confirm stages live in actions-special.ts;
 * this file continues the `suspend-file` and `resume-file` pendings.
 */

import {
  BAD_SAVE,
  MAX_STATE,
  NDEATHS,
  NDWARVES,
  NHINTS,
  NLOCATIONS,
  NOBJECTS,
  RESUME_HELP,
  SAVE_TAMPERING,
  VERSION_SKEW,
} from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import { BLOCKED, GO_TOP } from './actions-special';
import type { ActionResult } from './actions-special';
import { beginFileName, eofFileName, rspeak } from './io';
import type { IoCtx } from './io';
import { computeScore } from './score';
import type {
  Game,
  GameState,
  Pending,
  Session,
  Storage,
} from './types';

/** C: ADVENT_MAGIC (advent.h). The JSON document carries it without the LF. */
export const ADVENT_MAGIC = 'open-adventure';
/** C: SAVE_VERSION (advent.h). */
export const SAVE_VERSION = 32;
/** C: ENDIAN_MAGIC (saveresume.c). */
export const ENDIAN_MAGIC = 2317;
/** C: LCG_M (advent.h). */
const LCG_M = 1048576;
/** Largest accepted Save_Document text (characters). */
export const MAX_SAVE_CHARS = 1_000_000;

/** C: STATE_NOTFOUND (advent.h). */
const STATE_NOTFOUND = -1;
/** C: NO_OBJECT (advent.h). */
const NO_OBJECT = 0;
/** C: LOC_NOWHERE (advent.h). */
const LOC_NOWHERE = 0;

/** Why a Save_Document was rejected. */
export type RejectReason = 'bad-save' | 'version-skew' | 'tampered';

export type DeserializeResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: RejectReason; version?: number };

/* ---- serialization ---- */

/** Recursively copy a JSON value with object keys in sorted order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = canonical(src[key]);
    }
    return out;
  }
  return value;
}

/**
 * C: savefile (saveresume.c). Canonical Save_Document text: top-level keys in
 * the fixed order magic, version, canary, game, session; nested keys sorted.
 */
export function serialize(state: GameState): string {
  return JSON.stringify({
    magic: ADVENT_MAGIC,
    version: SAVE_VERSION,
    canary: ENDIAN_MAGIC,
    game: canonical(state.game),
    session: canonical(state.session),
  });
}

/* ---- shape checks (a failure is BAD_SAVE) ---- */

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isIntArray(v: unknown, len: number): v is number[] {
  return Array.isArray(v) && v.length === len && v.every(isInt);
}

const GAME_INT_FIELDS = [
  'lcg_x', 'abbnum', 'chloc', 'chloc2', 'clock1', 'clock2', 'conds', 'detail',
  'dflag', 'dkill', 'dtotal', 'foobar', 'holdng', 'igo', 'iwest', 'knfloc',
  'limit', 'loc', 'newloc', 'numdie', 'oldloc', 'oldlc2', 'oldobj', 'saved',
  'tally', 'thresh', 'trnluz', 'turns',
] as const;

const GAME_BOOL_FIELDS = [
  'clshnt', 'closed', 'closng', 'lmwarn', 'novice', 'panic', 'wzdark',
  'blooded', 'seenbigwords',
] as const;

/** Shape check of a parsed `game` value (types and array lengths only). */
function hasGameShape(g: unknown): g is Game {
  if (!isRec(g)) return false;
  for (const k of GAME_INT_FIELDS) if (!isInt(g[k])) return false;
  for (const k of GAME_BOOL_FIELDS) if (!isBool(g[k])) return false;
  if (!isInt(g.bonus) || g.bonus < 0 || g.bonus > 3) return false;
  if (typeof g.zzword !== 'string') return false;

  const { locs, dwarves, objects, hints, link } = g;
  if (!Array.isArray(locs) || locs.length !== NLOCATIONS) return false;
  for (const l of locs) {
    if (!isRec(l) || !isInt(l.abbrev) || !isInt(l.atloc)) return false;
  }
  if (!Array.isArray(dwarves) || dwarves.length !== NDWARVES + 1) return false;
  for (const d of dwarves) {
    if (!isRec(d) || !isBool(d.seen) || !isInt(d.loc) || !isInt(d.oldloc)) {
      return false;
    }
  }
  if (!Array.isArray(objects) || objects.length !== NOBJECTS) return false;
  for (const o of objects) {
    if (
      !isRec(o) ||
      !isInt(o.fixed) ||
      !isInt(o.prop) ||
      !isInt(o.place)
    ) {
      return false;
    }
  }
  if (!Array.isArray(hints) || hints.length !== NHINTS) return false;
  for (const h of hints) {
    if (!isRec(h) || !isBool(h.used) || !isInt(h.lc)) return false;
  }
  return isIntArray(link, NOBJECTS * 2);
}

function hasWordShape(w: unknown): boolean {
  return (
    isRec(w) &&
    typeof w.raw === 'string' &&
    isInt(w.id) &&
    isInt(w.type) &&
    w.type >= 0 &&
    w.type <= 4
  );
}

const CROAK_ORIGINS = ['dwarf', 'nowhere', 'pit', 'bridge'];
const SIMPLE_PENDING_TAGS = [
  'novice', 'command', 'dragon', 'quit', 'clue', 'suspend-confirm',
  'suspend-file', 'resume-confirm', 'resume-file',
];

function hasPendingShape(p: unknown): p is Pending {
  if (!isRec(p) || typeof p.k !== 'string') return false;
  if (SIMPLE_PENDING_TAGS.includes(p.k)) return true;
  if (p.k === 'hint-question' || p.k === 'hint-confirm') return isInt(p.hint);
  if (p.k === 'croak') {
    return (
      typeof p.origin === 'string' &&
      CROAK_ORIGINS.includes(p.origin) &&
      isInt(p.obit)
    );
  }
  return false;
}

const EXIT_REASONS = [null, 'quit', 'endgame', 'suspended', 'tampered', 'eof'];

/** Shape check of a parsed `session` value. */
function hasSessionShape(s: unknown): s is Session {
  if (!isRec(s)) return false;
  if (
    !isRec(s.settings) ||
    !isBool(s.settings.oldstyle) ||
    !isBool(s.settings.prompt)
  ) {
    return false;
  }
  const cmd = s.cmd;
  if (
    !isRec(cmd) ||
    !isInt(cmd.part) || cmd.part < 0 || cmd.part > 2 ||
    !isInt(cmd.verb) ||
    !isInt(cmd.obj) ||
    !isInt(cmd.state) || cmd.state < 0 || cmd.state > 6 ||
    !Array.isArray(cmd.word) ||
    cmd.word.length !== 2 ||
    !cmd.word.every(hasWordShape)
  ) {
    return false;
  }
  if (!hasPendingShape(s.pending)) return false;
  if (s.status !== 'running' && s.status !== 'over') return false;
  if (!EXIT_REASONS.includes(s.exitReason as string | null)) return false;
  return isInt(s.reportedLimit) && isInt(s.reportedScore);
}

/* ---- range checks ---- */

/** C: is_valid (saveresume.c). True when the game state is within bounds. */
export function isValid(g: Game): boolean {
  /* Prevent division by zero */
  if (g.abbnum === 0) return false;

  /* Check for RNG overflow. Truncate */
  if (g.lcg_x >= LCG_M) return false;

  /* Bounds check for locations */
  if (
    g.chloc < -1 || g.chloc >= NLOCATIONS ||
    g.chloc2 < -1 || g.chloc2 >= NLOCATIONS ||
    g.loc < 0 || g.loc >= NLOCATIONS ||
    g.newloc < 0 || g.newloc >= NLOCATIONS ||
    g.oldloc < 0 || g.oldloc >= NLOCATIONS ||
    g.oldlc2 < 0 || g.oldlc2 >= NLOCATIONS
  ) {
    return false;
  }
  /* Bounds check for location arrays */
  for (let i = 0; i <= NDWARVES; i++) {
    const d = g.dwarves[i]!;
    if (
      d.loc < -1 || d.loc >= NLOCATIONS ||
      d.oldloc < -1 || d.oldloc >= NLOCATIONS
    ) {
      return false;
    }
  }

  for (let i = 0; i < NOBJECTS; i++) {
    const o = g.objects[i]!;
    if (
      o.place < -1 || o.place >= NLOCATIONS ||
      o.fixed < -1 || o.fixed >= NLOCATIONS
    ) {
      return false;
    }
  }

  /* Bounds check for dwarves */
  if (g.dtotal < 0 || g.dtotal > NDWARVES || g.dkill < 0 || g.dkill > NDWARVES) {
    return false;
  }

  /* Validate that we didn't die too many times in save */
  if (g.numdie >= NDEATHS) return false;

  /* Recalculate tally, throw the towel if in disagreement */
  let tempTally = 0;
  for (let treasure = 1; treasure < NOBJECTS; treasure++) {
    if (OBJECTS[treasure]!.isTreasure) {
      if (g.objects[treasure]!.prop === STATE_NOTFOUND) ++tempTally;
    }
  }
  if (tempTally !== g.tally) return false;

  /* Check that properties of objects aren't beyond expected */
  for (let obj = 0; obj < NOBJECTS; obj++) {
    const val = g.objects[obj]!.prop;
    if (val < -MAX_STATE - 1 || val > MAX_STATE) return false;
  }

  /* Check that values in linked lists for objects in locations are inside
   * bounds */
  for (let loc = LOC_NOWHERE; loc < NLOCATIONS; loc++) {
    const a = g.locs[loc]!.atloc;
    if (a < NO_OBJECT || a >= NOBJECTS * 2) return false;
  }
  for (let obj = 0; obj < NOBJECTS * 2; obj++) {
    const l = g.link[obj]!;
    if (l < NO_OBJECT || l >= NOBJECTS * 2) return false;
  }

  return true;
}

/* ---- parsing a document ---- */

/**
 * The three checks of C: restore (saveresume.c), in C order: magic/canary
 * (bad-save), version (version-skew), is_valid (tampered). Shape failures of
 * game (and of session when `needSession`) are bad-save. Never throws.
 */
function parseDocument(text: unknown, needSession: boolean): DeserializeResult {
  if (typeof text !== 'string' || text.length > MAX_SAVE_CHARS) {
    return { ok: false, reason: 'bad-save' };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad-save' };
  }
  if (!isRec(doc)) return { ok: false, reason: 'bad-save' };

  if (doc.magic !== ADVENT_MAGIC || doc.canary !== ENDIAN_MAGIC) {
    return { ok: false, reason: 'bad-save' };
  }
  if (!isInt(doc.version)) return { ok: false, reason: 'bad-save' };
  if (doc.version !== SAVE_VERSION) {
    return { ok: false, reason: 'version-skew', version: doc.version };
  }
  if (!hasGameShape(doc.game)) return { ok: false, reason: 'bad-save' };
  if (needSession && !hasSessionShape(doc.session)) {
    return { ok: false, reason: 'bad-save' };
  }
  if (!isValid(doc.game)) return { ok: false, reason: 'tampered' };

  return {
    ok: true,
    state: {
      game: doc.game,
      session: needSession ? (doc.session as Session) : ({} as Session),
    },
  };
}

/**
 * Parse a Save_Document into a GameState. Never throws; a rejection carries
 * the reason (`bad-save`, `version-skew` with `version`, or `tampered`).
 */
export function deserialize(text: string): DeserializeResult {
  return parseDocument(text, true);
}

/* ---- restore, suspend and resume ---- */

/** C: strip (saveresume.c). Trims C isspace characters from both ends. */
function strip(name: string): string {
  return name.replace(/^[ \t\n\v\f\r]+/, '').replace(/[ \t\n\v\f\r]+$/, '');
}

/** Emit the game-over event for an exit() that prints no score. */
function exitSession(
  ctx: IoCtx,
  session: Session,
  reason: 'suspended' | 'tampered',
): void {
  session.status = 'over';
  session.exitReason = reason;
  ctx.events.push({
    type: 'game-over',
    score: computeScore(ctx.game, 'scoregame').score,
    rank: null,
    reason,
    already: false,
  });
}

/**
 * C: restore (saveresume.c). Applies the three checks to the save text. On
 * success only `game` is replaced (in place, as C replaces `game` only);
 * `session` is untouched. SAVE_TAMPERING ends the game (C: exit). Returns
 * GO_TOP; the caller checks `session.status` first.
 */
export function restore(
  ctx: IoCtx,
  session: Session,
  text: string,
): ActionResult {
  const result = parseDocument(text, false);
  if (result.ok) {
    Object.assign(ctx.game, result.state.game);
    return GO_TOP;
  }
  if (result.reason === 'bad-save') {
    rspeak(ctx, BAD_SAVE);
  } else if (result.reason === 'version-skew') {
    const v = result.version ?? 0;
    rspeak(
      ctx,
      VERSION_SKEW,
      Math.trunc(v / 10),
      v % 10,
      Math.trunc(SAVE_VERSION / 10),
      SAVE_VERSION % 10,
    );
  } else {
    rspeak(ctx, SAVE_TAMPERING);
    exitSession(ctx, session, 'tampered');
  }
  return GO_TOP;
}

/** C: printf("Can't open file %s, try again.\n", name) then the next prompt. */
function retryFileName(ctx: IoCtx, name: string): ActionResult {
  ctx.events.push({
    type: 'text',
    channel: 'io',
    blank: false,
    template: null,
    text: `Can't open file ${name}, try again.\n`,
  });
  beginFileName(ctx);
  return BLOCKED;
}

/**
 * C: suspend (saveresume.c), continuation of the file-name loop (pending
 * `suspend-file`). `reply` is the raw line. An empty name returns GO_TOP; a
 * failed write prints the retry message and blocks again. On success: write
 * the Save_Document, speak RESUME_HELP and end the session (C: exit) with no
 * score output (C-7). The caller checks `session.status` before the phase.
 */
export function resumeSuspendFile(
  ctx: IoCtx,
  session: Session,
  storage: Storage,
  reply: string,
  state: GameState,
): ActionResult {
  const name = strip(reply);
  if (name.length === 0) {
    return GO_TOP;
  }
  if (!storage.write(name, serialize(state))) {
    return retryFileName(ctx, name);
  }
  rspeak(ctx, RESUME_HELP);
  exitSession(ctx, session, 'suspended');
  return GO_TOP;
}

/**
 * C: resume (saveresume.c), continuation of the file-name loop (pending
 * `resume-file`). An empty name returns GO_TOP; an unreadable file prints the
 * retry message and blocks again; otherwise the text goes through `restore`.
 */
export function resumeResumeFile(
  ctx: IoCtx,
  session: Session,
  storage: Storage,
  reply: string,
): ActionResult {
  const name = strip(reply);
  if (name.length === 0) {
    return GO_TOP;
  }
  const text = storage.read(name);
  if (text === undefined) {
    return retryFileName(ctx, name);
  }
  return restore(ctx, session, text);
}

/**
 * C: myreadline returning NULL during a file-name read (end of input): the
 * prompt text is printed and the C code returns GO_TOP.
 */
export function eofFileNameStage(ctx: IoCtx): ActionResult {
  eofFileName(ctx);
  return GO_TOP;
}
