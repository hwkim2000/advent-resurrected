/*
 * Output_Event types for the Open Adventure TypeScript port.
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

/** Channel of a text event; determines how the renderer turns it into bytes. */
export type TextChannel = 'speak' | 'sspeak' | 'echo' | 'io';

export type DeathCause = 'dwarf' | 'pit' | 'bridge' | 'nowhere';

export type PromptKind = 'command' | 'yesno' | 'filename';

/** Text printed by the C program. `text` carries the original game text. */
export interface TextEvent {
  type: 'text';
  channel: TextChannel;
  blank: boolean;
  /** The Game_Data string before %-substitution, or null when not template-based. */
  template: string | null;
  text: string;
}

export interface RoomEnteredEvent {
  type: 'room-entered';
  loc: number;
}

export interface LampLevelEvent {
  type: 'lamp-level';
  life: number;
  initial: number;
}

export interface DeathEvent {
  type: 'death';
  cause: DeathCause;
  count: number;
}

export interface ReincarnationOfferedEvent {
  type: 'reincarnation-offered';
  obituary: number;
}

export interface MagicWordUsedEvent {
  type: 'magic-word-used';
  word: string;
}

export interface ScoreEvent {
  type: 'score';
  score: number;
  max: number;
}

export interface PromptEvent {
  type: 'prompt';
  kind: PromptKind;
  text: string;
}

export interface GameOverEvent {
  type: 'game-over';
  score: number;
  rank: string | null;
  reason: string;
  /** True when the input arrived after the game had already ended. */
  already: boolean;
}

/** JSON-safe discriminated union of everything the engine reports. */
export type OutputEvent =
  | TextEvent
  | RoomEnteredEvent
  | LampLevelEvent
  | DeathEvent
  | ReincarnationOfferedEvent
  | MagicWordUsedEvent
  | ScoreEvent
  | PromptEvent
  | GameOverEvent;
