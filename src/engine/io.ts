/*
 * Output and input primitives for the Open Adventure TypeScript port.
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
 * The C program blocks on stdin. Here every blocking read is split in two:
 * a `begin*` function that emits the prompt, and a function that consumes the
 * line the caller later supplies. The caller (main-loop) stores a Pending tag
 * between the two.
 */

import {
  COND_ABOVE,
  COND_FOREST,
  LOC_BUILDING,
  PLEASE_ANSWER,
} from '../data/constants';
import { ARBITRARY_MESSAGES, CONDITIONS, OBJECTS } from '../data/dungeon';
import type { OutputEvent, PromptKind, TextChannel } from './events';
import type { Game, Settings } from './types';

/** Collects the events produced during one step. */
export interface IoCtx {
  game: Game;
  events: OutputEvent[];
}

/** One printf-style argument (`%d` takes a number, `%s` a string). */
export type SpeakArg = number | string;

/** C: PROMPT (advent.h). */
export const PROMPT = '> ';
/** C: the prompt passed to myreadline in suspend/resume (saveresume.c). */
export const FILE_NAME_PROMPT = '\nFile name: ';
/** C: VERSION (Makefile, from NEWS.adoc) used by the %V specifier. */
export const VERSION = '1.22';
/** C: the size of the render buffer in vspeak. */
const RENDER_SIZE = 4096;

/** C: enum speaktype (advent.h). */
export type SpeakType = 'touch' | 'look' | 'hear' | 'study' | 'change';

/** C: INSIDE(LOC) (advent.h): !OUTSIDE(LOC) || LOC == LOC_BUILDING. */
function inside(loc: number): boolean {
  const cond = CONDITIONS[loc] ?? 0;
  const outside = (cond & (1 << COND_ABOVE)) !== 0 || (cond & (1 << COND_FOREST)) !== 0;
  return !outside || loc === LOC_BUILDING;
}

function pushText(
  ctx: IoCtx,
  channel: TextChannel,
  blank: boolean,
  template: string | null,
  text: string,
): void {
  ctx.events.push({ type: 'text', channel, blank, template, text });
}

/**
 * C: vspeak (misc.c). Returns the rendered text, or null when the message is
 * NULL or empty (nothing is printed in that case).
 */
function renderMessage(
  ctx: IoCtx,
  msg: string | null | undefined,
  args: readonly SpeakArg[],
): string | null {
  if (msg === null || msg === undefined || msg.length === 0) return null;

  const msglen = msg.length;
  let out = '';
  let size = RENDER_SIZE;
  let argi = 0;
  let pluralize = false;

  for (let i = 0; i < msglen && size > 1; i++) {
    if (msg[i] !== '%') {
      // Artifacts "on the floor" dropped outside both cave and building.
      const after = i + 5 >= msglen ? '\0' : msg[i + 5];
      if (
        msg.startsWith('floor', i) &&
        (after === ' ' || after === '.' || after === '\0') &&
        !inside(ctx.game.loc)
      ) {
        let copy = size - 1;
        if (copy > 'ground'.length) copy = 'ground'.length;
        out += 'ground'.slice(0, copy);
        size -= copy;
        i += 4;
      } else {
        out += msg[i];
        size--;
      }
    } else {
      i++;
      const spec = msg[i];
      if (spec === 'd') {
        const arg = Number(args[argi++] ?? 0) | 0;
        let s = String(arg);
        if (s.length >= size) {
          s = s.slice(0, size - 1);
          size = 1;
        } else {
          size -= s.length;
        }
        out += s;
        pluralize = arg !== 1;
      }
      if (spec === 's') {
        let s = String(args[argi++] ?? '');
        if (s.length >= size) s = s.slice(0, size - 1);
        out += s;
        size -= s.length;
      }
      if (spec === 'S') {
        // Look at the *previous* numeric parameter.
        if (pluralize && size > 1) {
          out += 's';
          size--;
        }
      }
      if (spec === 'V') {
        let s = VERSION;
        if (s.length >= size) s = s.slice(0, size - 1);
        out += s;
        size -= s.length;
      }
    }
  }
  return out;
}

/** C: vspeak (misc.c) - engine for the speak functions. */
function vspeak(
  ctx: IoCtx,
  msg: string | null | undefined,
  blank: boolean,
  args: readonly SpeakArg[],
): void {
  const text = renderMessage(ctx, msg, args);
  if (text === null) return;
  pushText(ctx, 'speak', blank, msg as string, text);
}

/** C: speak (misc.c) - speak a specified string, preceded by a blank line. */
export function speak(
  ctx: IoCtx,
  msg: string | null | undefined,
  ...args: SpeakArg[]
): void {
  vspeak(ctx, msg, true, args);
}

/** Minimal printf for sspeak: supports %d, %s and %%. */
function formatPrintf(fmt: string, args: readonly SpeakArg[]): string {
  let out = '';
  let argi = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      continue;
    }
    i++;
    const spec = fmt[i];
    if (spec === 'd') out += String(Number(args[argi++] ?? 0) | 0);
    else if (spec === 's') out += String(args[argi++] ?? '');
    else if (spec === '%') out += '%';
  }
  return out;
}

/**
 * C: sspeak (misc.c) - speak an arbitrary message with raw vprintf: always
 * blank-bracketed, no `floor` pass.
 */
export function sspeak(ctx: IoCtx, msg: number, ...args: SpeakArg[]): void {
  const template = ARBITRARY_MESSAGES[msg] ?? null;
  const text = formatPrintf(template ?? '', args);
  pushText(ctx, 'sspeak', true, template, text);
}

/**
 * C: pspeak (misc.c) - find the skip+1st message of an object and print it.
 * Modes: touch = inventory text, look = description, hear = sound,
 * study = text on the object, change = state-change message.
 */
export function pspeak(
  ctx: IoCtx,
  msg: number,
  mode: SpeakType,
  blank: boolean,
  skip: number,
  ...args: SpeakArg[]
): void {
  const obj = OBJECTS[msg];
  if (obj === undefined) return;
  switch (mode) {
    case 'touch':
      vspeak(ctx, obj.inventory, blank, args);
      break;
    case 'look':
      vspeak(ctx, obj.descriptions?.[skip], blank, args);
      break;
    case 'hear':
      vspeak(ctx, obj.sounds?.[skip], blank, args);
      break;
    case 'study':
      vspeak(ctx, obj.texts?.[skip], blank, args);
      break;
    case 'change':
      vspeak(ctx, obj.changes?.[skip], blank, args);
      break;
  }
}

/** C: rspeak (misc.c) - print the i-th arbitrary ("random") message. */
export function rspeak(ctx: IoCtx, i: number, ...args: SpeakArg[]): void {
  vspeak(ctx, ARBITRARY_MESSAGES[i], true, args);
}

/** The prompt string used by get_input (empty in -o mode). C: get_input. */
export function promptText(settings: Settings): string {
  return settings.prompt ? PROMPT : '';
}

/**
 * C: get_input (misc.c), first half - print a blank line and block for input.
 * Emits `io "\n"` and a `prompt` event; the caller records the Pending tag.
 */
export function beginInput(
  ctx: IoCtx,
  settings: Settings,
  kind: Exclude<PromptKind, 'filename'>,
): void {
  pushText(ctx, 'io', false, null, '\n');
  ctx.events.push({ type: 'prompt', kind, text: promptText(settings) });
}

/**
 * C: get_input (misc.c), second half - consume one line.
 * Returns null when the line is a `#` comment (ignored silently; the caller
 * keeps the same Pending tag and nothing is emitted). Otherwise strips at the
 * first newline, emits the echo event and returns the line.
 */
export function receiveInput(
  ctx: IoCtx,
  settings: Settings,
  line: string,
): string | null {
  if (line.startsWith('#')) return null;
  const nl = line.indexOf('\n');
  const input = nl >= 0 ? line.slice(0, nl) : line;
  pushText(ctx, 'echo', false, null, promptText(settings) + input);
  return input;
}

/**
 * C: myreadline (main.c) at end of input - the prompt is written to stdout
 * and NULL is returned. Used for get_input; the caller then ends the game.
 */
export function eofInput(ctx: IoCtx, settings: Settings): void {
  const p = promptText(settings);
  if (p.length > 0) pushText(ctx, 'io', false, null, p);
}

/**
 * C: myreadline("\nFile name: ") (saveresume.c), first half. A file-name read
 * prints nothing on a non-tty; only a `prompt` event is emitted.
 */
export function beginFileName(ctx: IoCtx): void {
  ctx.events.push({ type: 'prompt', kind: 'filename', text: FILE_NAME_PROMPT });
}

/** C: myreadline at end of input during a file-name read: prompt is printed. */
export function eofFileName(ctx: IoCtx): void {
  pushText(ctx, 'io', false, null, FILE_NAME_PROMPT);
}

export type Answer = 'yes' | 'no' | 'invalid';

/**
 * C: answer classification shared by yes_or_no and silent_yes_or_no.
 * First whitespace-delimited word, ASCII-lowercased: starts with y = yes,
 * starts with n = no. Empty or anything else is invalid.
 */
export function classifyAnswer(reply: string): Answer {
  // sscanf("%s"): skip C isspace, then take non-space characters.
  const m = /^[ \t\n\v\f\r]*([^ \t\n\v\f\r]*)/.exec(reply);
  const first = (m?.[1] ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (first.startsWith('y')) return 'yes';
  if (first.startsWith('n')) return 'no';
  return 'invalid';
}

/** C: yes_or_no (misc.c), first half - speak the question and block. */
export function askYesNo(
  ctx: IoCtx,
  settings: Settings,
  question: string | null,
): void {
  speak(ctx, question);
  beginInput(ctx, settings, 'yesno');
}

/**
 * C: silent_yes_or_no (misc.c), first half - block without a question.
 * (Question text was already spoken by the caller via rspeak.)
 */
export function askSilentYesNo(ctx: IoCtx, settings: Settings): void {
  beginInput(ctx, settings, 'yesno');
}

/**
 * C: yes_or_no (misc.c), second half. `reply` is a line already accepted by
 * receiveInput. Returns true/false when answered (after speaking the yes or
 * no response); on an invalid answer speaks PLEASE_ANSWER, re-asks, and
 * returns null so the caller keeps the same Pending tag.
 */
export function answerYesNo(
  ctx: IoCtx,
  settings: Settings,
  reply: string,
  question: string | null,
  yesResponse: string | null,
  noResponse: string | null,
): boolean | null {
  const a = reply.length === 0 ? 'invalid' : classifyAnswer(reply);
  if (a === 'yes') {
    speak(ctx, yesResponse);
    return true;
  }
  if (a === 'no') {
    speak(ctx, noResponse);
    return false;
  }
  rspeak(ctx, PLEASE_ANSWER);
  askYesNo(ctx, settings, question);
  return null;
}

/**
 * C: silent_yes_or_no (misc.c), second half. Returns true/false when answered;
 * on an invalid answer speaks PLEASE_ANSWER, blocks again (without repeating
 * any question) and returns null.
 */
export function answerSilentYesNo(
  ctx: IoCtx,
  settings: Settings,
  reply: string,
): boolean | null {
  const a = reply.length === 0 ? 'invalid' : classifyAnswer(reply);
  if (a === 'yes') return true;
  if (a === 'no') return false;
  rspeak(ctx, PLEASE_ANSWER);
  askSilentYesNo(ctx, settings);
  return null;
}
