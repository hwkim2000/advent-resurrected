/**
 * Game_Context for the AI parser: the current room, the visible objects and
 * the last two accepted commands. New code; read-only over the engine state.
 */
import { NOBJECTS, NUGGET, STEPS } from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import { isDarkHere, objectIsNotFound, objectIsStashed, toting } from '../engine/objects';
import type { GameState } from '../engine/types';
import { roomText } from '../shared/context-rules';
import type { GameContext } from '../shared/context-rules';
import { isContextCommand, validateCommand } from '../shared/command-validation';
import { DARK_ROOM, LAST_MAX, OBJECTS_MAX } from '../shared/limits';
import { normalizePlayerText } from '../shared/normalize';

/**
 * Mirrors C listobjects (main.c): walk atloc through link at the current
 * location, map twin entries to the base object, skip STEPS while the nugget
 * is carried, and skip not-yet-found or stashed objects once the cave is
 * closed. Unlike the C function this has no side effects (no abbrev bump,
 * no found marking, no tally change).
 */
function visibleObjectIndexes(state: GameState): number[] {
  const game = state.game;
  const seen = new Set<number>();
  const loc = game.locs[game.loc];
  if (loc === undefined) return [];
  // Bound the walk so a corrupt link chain cannot loop forever.
  let guard = 0;
  for (let i = loc.atloc; i !== 0 && guard < 1000; i = game.link[i] ?? 0, guard++) {
    let obj = i;
    if (obj >= NOBJECTS) obj -= NOBJECTS;
    if (obj === STEPS && toting(game, NUGGET)) continue;
    if (game.objects[obj] === undefined) continue;
    if ((objectIsStashed(game, obj) || objectIsNotFound(game, obj)) && game.closed) continue;
    const words = OBJECTS[obj]?.words;
    if (words === undefined || words[0] === undefined) continue;
    seen.add(obj);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Build the Game_Context for the current state. Does not modify the state. */
export function buildGameContext(state: GameState, last: readonly string[]): GameContext {
  const game = state.game;
  const dark = isDarkHere(game);
  const objects: string[] = [];
  if (!dark) {
    const words = new Set<string>();
    for (const obj of visibleObjectIndexes(state)) {
      const first = OBJECTS[obj]?.words[0];
      if (first !== undefined) words.add(first.toUpperCase());
    }
    objects.push(...[...words].slice(0, OBJECTS_MAX));
  }
  return {
    room: dark ? DARK_ROOM : roomText(game.loc),
    objects,
    last: last.slice(-LAST_MAX),
  };
}

/** Remembers the last accepted commands for the context. Not persisted. */
export class CommandMemory {
  private entries: string[] = [];

  /** Forget everything (new game or restore). */
  reset(): void {
    this.entries = [];
  }

  /** Record the canonical form of a command if it is a valid, non-meta command. */
  note(text: string): void {
    const result = validateCommand(normalizePlayerText(text).toUpperCase());
    if (!result.ok || !isContextCommand(result.command)) return;
    this.entries.push(result.command);
    if (this.entries.length > LAST_MAX) this.entries.splice(0, this.entries.length - LAST_MAX);
  }

  /** At most two commands, oldest first. */
  get last(): string[] {
    return [...this.entries];
  }
}
