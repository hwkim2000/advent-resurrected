/*
 * Shared fast-check builders for the engine property tests (task 10.1).
 *
 * Ported-game test support for Open Adventure (https://gitlab.com/esr/open-adventure).
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

import fc from 'fast-check';
import { ACTIONS, MOTIONS, OBJECTS } from '../../src/data/dungeon';
import { NDWARVES, NLOCATIONS } from '../../src/data/constants';
import { cloneState, endOfInput, newGame, start, step } from '../../src/engine';
import type { Env, Game, GameState, Storage } from '../../src/engine';
import { isValid } from '../../src/engine/save-resume';

/* ---- common configuration ---- */

/** Common fast-check parameters: 100 runs; failures print seed and counterexample. */
export const PBT_CONFIG: fc.Parameters<unknown> = {
  numRuns: 100,
  verbose: 1,
};

/** Run a property with PBT_CONFIG (the failure report includes seed and shrunk example). */
export function assertProperty<T>(property: fc.IPropertyWithHooks<T>): void {
  fc.assert(property, PBT_CONFIG as fc.Parameters<T>);
}

/* ---- environment ---- */

/** Simple in-memory Storage for property tests. */
export function makeStorage(files: Record<string, string> = {}): Storage & {
  files: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(files));
  return {
    files: map,
    read: (name) => map.get(name),
    write: (name, data) => {
      if (name === '' || name.endsWith('/')) return false;
      map.set(name, data);
      return true;
    },
  };
}

export function makeEnv(): Env {
  return { storage: makeStorage() };
}

/* ---- vocabulary ---- */

function wordsOf(table: readonly { readonly words: readonly string[] }[]): string[] {
  const out: string[] = [];
  for (const entry of table) for (const w of entry.words) out.push(w);
  return out;
}

export const MOTION_WORDS: readonly string[] = wordsOf(MOTIONS);
export const OBJECT_WORDS: readonly string[] = wordsOf(OBJECTS);
export const ACTION_WORDS: readonly string[] = wordsOf(ACTIONS);
/** Magic words that the game reacts to (C: bigwords, foobar, the Plover/Plugh moves). */
export const MAGIC_WORDS: readonly string[] = [
  'xyzzy', 'plugh', 'plover', 'fee', 'fie', 'foe', 'foo', 'fum',
];
export const YES_NO_WORDS: readonly string[] = ['yes', 'y', 'no', 'n'];

export const motionWord: fc.Arbitrary<string> = fc.constantFrom(...MOTION_WORDS);
export const objectWord: fc.Arbitrary<string> = fc.constantFrom(...OBJECT_WORDS);
export const actionWord: fc.Arbitrary<string> = fc.constantFrom(...ACTION_WORDS);
export const magicWord: fc.Arbitrary<string> = fc.constantFrom(...MAGIC_WORDS);
export const yesNoWord: fc.Arbitrary<string> = fc.constantFrom(...YES_NO_WORDS);

/** A valid vocabulary word of any kind (motion, object, action, magic, yes/no). */
export const vocabWord: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: motionWord, weight: 4 },
  { arbitrary: objectWord, weight: 2 },
  { arbitrary: actionWord, weight: 3 },
  { arbitrary: magicWord, weight: 1 },
  { arbitrary: yesNoWord, weight: 1 },
);

/** A verb + object pair, e.g. `take lamp`. */
export const verbObjectCommand: fc.Arbitrary<string> = fc
  .tuple(actionWord, objectWord)
  .map(([v, o]) => `${v} ${o}`);

/** One input line built from the vocabulary: single word or verb/object pair. */
export const vocabCommand: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: vocabWord, weight: 5 },
  { arbitrary: verbObjectCommand, weight: 3 },
  { arbitrary: fc.tuple(vocabWord, vocabWord).map(([a, b]) => `${a} ${b}`), weight: 1 },
);

/** A list of vocabulary commands. */
export function vocabCommands(maxLength = 40): fc.Arbitrary<string[]> {
  return fc.array(vocabCommand, { maxLength });
}

/** Any 32-bit signed seed. */
export const seedArb: fc.Arbitrary<number> = fc.integer({
  min: -2147483648,
  max: 2147483647,
});

/* ---- reachable states ---- */

/**
 * Replay `commands` from `newGame(seed)` through start/step. Stops early once
 * the game is over. Returns the final state and all events produced.
 */
export function replayCommands(
  seed: number,
  commands: readonly string[],
  env: Env = makeEnv(),
): { state: GameState; events: import('../../src/engine').OutputEvent[] } {
  let state = newGame(seed);
  const first = start(state, env);
  state = first.state;
  const events = [...first.events];
  for (const line of commands) {
    if (state.session.status === 'over') break;
    const r = step(state, line, env);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/** Replay commands then signal end of input; used where EOF handling matters. */
export function replayToEof(seed: number, commands: readonly string[]): GameState {
  const env = makeEnv();
  const { state } = replayCommands(seed, commands, env);
  if (state.session.status === 'over') return state;
  return endOfInput(state, env).state;
}

/** A reachable game state: replay a generated command list from `newGame(seed)`. */
export const reachableState: fc.Arbitrary<GameState> = fc
  .tuple(seedArb, vocabCommands(40))
  .map(([seed, cmds]) => replayCommands(seed, cmds).state);

/** A reachable state together with the seed and commands that produced it. */
export const reachableScenario: fc.Arbitrary<{
  seed: number;
  commands: string[];
  state: GameState;
}> = fc.tuple(seedArb, vocabCommands(40)).map(([seed, commands]) => ({
  seed,
  commands,
  state: replayCommands(seed, commands).state,
}));

/* ---- synthetic games ---- */

/**
 * A synthetic Game: starts from `newGame(seed)` and sets scalar fields within
 * the bounds that C: is_valid accepts. The object tally and linked lists are
 * left consistent (only non-treasure `prop` values are varied). The result
 * always satisfies `isValid`.
 */
export const syntheticState: fc.Arbitrary<GameState> = fc
  .record({
    seed: seedArb,
    oldstyle: fc.boolean(),
    loc: fc.integer({ min: 1, max: NLOCATIONS - 1 }),
    newloc: fc.integer({ min: 1, max: NLOCATIONS - 1 }),
    oldloc: fc.integer({ min: 1, max: NLOCATIONS - 1 }),
    oldlc2: fc.integer({ min: 1, max: NLOCATIONS - 1 }),
    turns: fc.integer({ min: 0, max: 2000 }),
    limit: fc.integer({ min: -1, max: 330 }),
    saved: fc.integer({ min: 0, max: 15 }),
    numdie: fc.integer({ min: 0, max: 2 }),
    abbnum: fc.integer({ min: 1, max: 10 }),
    dflag: fc.integer({ min: 0, max: 3 }),
    dkill: fc.integer({ min: 0, max: NDWARVES }),
    dtotal: fc.integer({ min: 0, max: NDWARVES }),
    foobar: fc.integer({ min: 0, max: 3 }),
    holdng: fc.integer({ min: 0, max: 7 }),
    flags: fc.record({
      closng: fc.boolean(),
      lmwarn: fc.boolean(),
      novice: fc.boolean(),
      panic: fc.boolean(),
      clshnt: fc.boolean(),
      blooded: fc.boolean(),
      seenbigwords: fc.boolean(),
    }),
    dwarfLocs: fc.array(fc.integer({ min: -1, max: NLOCATIONS - 1 }), {
      minLength: NDWARVES + 1,
      maxLength: NDWARVES + 1,
    }),
    propBits: fc.array(fc.integer({ min: 0, max: 1 }), {
      minLength: 0,
      maxLength: 70,
    }),
  })
  .map((p) => {
    const state = cloneState(newGame(p.seed, { oldstyle: p.oldstyle }));
    const g: Game = state.game;
    g.loc = p.loc;
    g.newloc = p.newloc;
    g.oldloc = p.oldloc;
    g.oldlc2 = p.oldlc2;
    g.turns = p.turns;
    g.limit = p.limit;
    g.saved = p.saved;
    g.numdie = p.numdie;
    g.abbnum = p.abbnum;
    g.dflag = p.dflag;
    g.dkill = p.dkill;
    g.dtotal = p.dtotal;
    g.foobar = p.foobar;
    g.holdng = p.holdng;
    Object.assign(g, p.flags);
    p.dwarfLocs.forEach((l, i) => {
      g.dwarves[i]!.loc = l;
    });
    p.propBits.forEach((b, i) => {
      const obj = g.objects[i];
      // Treasures keep their prop so that `tally` stays consistent.
      if (obj && !OBJECTS[i]!.isTreasure && i > 0) obj.prop = b;
    });
    if (!isValid(g)) {
      // Should be unreachable; fall back to the plain new game.
      return newGame(p.seed, { oldstyle: p.oldstyle });
    }
    return state;
  });
