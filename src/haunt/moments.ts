/**
 * Key-moment detection for the narrator. Pure: compares the game state before
 * and after one engine call, plus the events it produced. No engine edits.
 *
 * New code (not a port). Field names and constants were checked against
 * src/engine/types.ts, src/engine/main-loop.ts and src/data/constants.ts.
 *
 * TurnInfo is declared structurally here (a copy of the shape in
 * src/ui/extension-hooks.ts); this module imports nothing from src/ui.
 */
import { DRAGON, DRAGON_DEAD, NDWARVES } from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import type { GameState, OutputEvent } from '../engine/index';
import { containsXyzzyMotionWord } from './spoken-word-rule';

/** Structural copy of src/ui TurnInfo. */
export interface TurnInfo {
  /** State before the call; undefined on the first present() of a game. */
  readonly before: GameState | undefined;
  readonly after: GameState;
  /** Text given to the engine ('' at game start). */
  readonly line: string;
  readonly origin: 'typed' | 'spoken';
}

export type MomentKind =
  | 'treasure'
  | 'dwarf'
  | 'pirate'
  | 'dragon'
  | 'lampDim'
  | 'lampOut'
  | 'maze'
  | 'backtrack'
  | 'death'
  | 'reincarnated'
  | 'declined'
  | 'spokenXyzzy';

/** Death causes grouped for the narrator: pit/bridge = fall. */
export type DeathGroup = 'fall' | 'dwarf' | 'other';

export interface Moment {
  readonly kind: MomentKind;
  /** Set for `death`. */
  readonly deathGroup?: DeathGroup;
  /** Set for `death`: the engine's death count (1..3). */
  readonly deathCount?: number;
}

/** Moments that bypass the cooldown and the once-per-life limit. */
export const BYPASS_KINDS: ReadonlySet<MomentKind> = new Set<MomentKind>([
  'death',
  'reincarnated',
  'declined',
  'spokenXyzzy',
]);

/** Regular moments, highest priority first. */
export const PRIORITY: readonly MomentKind[] = [
  'dragon',
  'pirate',
  'dwarf',
  'lampOut',
  'lampDim',
  'treasure',
  'maze',
  'backtrack',
];

/** C: CARRIED (advent.h). Not exported from the engine index, so copied here. */
const CARRIED = -1;
/** Index of the pirate in game.dwarves (C: PIRATE == NDWARVES). */
const PIRATE_INDEX = NDWARVES;

type DeathEvent = Extract<OutputEvent, { type: 'death' }>;

export function deathGroup(cause: DeathEvent['cause']): DeathGroup {
  if (cause === 'pit' || cause === 'bridge') return 'fall';
  if (cause === 'dwarf') return 'dwarf';
  return 'other';
}

function treasureTaken(before: GameState, after: GameState): boolean {
  const n = Math.min(before.game.objects.length, after.game.objects.length, OBJECTS.length);
  for (let i = 1; i < n; i++) {
    if (
      OBJECTS[i]!.isTreasure &&
      after.game.objects[i]!.place === CARRIED &&
      before.game.objects[i]!.place !== CARRIED
    ) {
      return true;
    }
  }
  return false;
}

function dwarfSeen(before: GameState, after: GameState): boolean {
  for (let i = 1; i < NDWARVES; i++) {
    if (!before.game.dwarves[i]!.seen && after.game.dwarves[i]!.seen) return true;
  }
  return false;
}

function mentionsMaze(events: readonly OutputEvent[]): boolean {
  return events.some((e) => e.type === 'text' && /all alike/i.test(e.text));
}

/**
 * All moments present in one turn, in no particular order. Edge-triggered:
 * the same state seen twice yields nothing the second time. Pure; never
 * throws on a well-formed turn.
 */
export function detectMoments(turn: TurnInfo, events: readonly OutputEvent[]): Moment[] {
  const { before, after } = turn;
  const out: Moment[] = [];

  for (const e of events) {
    if (e.type === 'death') {
      out.push({ kind: 'death', deathGroup: deathGroup(e.cause), deathCount: e.count });
    }
  }

  if (before !== undefined) {
    if (before.session.pending.k === 'croak') {
      if (after.session.status === 'over') out.push({ kind: 'declined' });
      else if (after.session.pending.k !== 'croak') out.push({ kind: 'reincarnated' });
    }

    if (treasureTaken(before, after)) out.push({ kind: 'treasure' });
    if (dwarfSeen(before, after)) out.push({ kind: 'dwarf' });
    // The engine clears pirate.seen in the same turn when the chest moves, so
    // the state diff alone misses some sightings; the pounce and spotted
    // messages both say "bearded pirate".
    if (
      (!before.game.dwarves[PIRATE_INDEX]!.seen && after.game.dwarves[PIRATE_INDEX]!.seen) ||
      events.some((e) => e.type === 'text' && /bearded pirate/i.test(e.text))
    ) {
      out.push({ kind: 'pirate' });
    }
    if (
      before.game.objects[DRAGON]!.prop !== DRAGON_DEAD &&
      after.game.objects[DRAGON]!.prop === DRAGON_DEAD
    ) {
      out.push({ kind: 'dragon' });
    }
    if (!before.game.lmwarn && after.game.lmwarn) out.push({ kind: 'lampDim' });
    if (before.game.limit !== -1 && after.game.limit === -1) out.push({ kind: 'lampOut' });

    // Going back to the room before the one just left (C: oldloc is the room
    // the player was in before the current one).
    const entered = events.find((e) => e.type === 'room-entered');
    if (
      entered !== undefined &&
      entered.type === 'room-entered' &&
      before.game.oldloc !== 0 &&
      entered.loc === before.game.oldloc &&
      entered.loc !== before.game.loc
    ) {
      out.push({ kind: 'backtrack' });
    }
  }

  if (mentionsMaze(events)) out.push({ kind: 'maze' });

  if (turn.origin === 'spoken' && containsXyzzyMotionWord(turn.line)) {
    out.push({ kind: 'spokenXyzzy' });
  }

  return out;
}
