/**
 * Hint_View: a small, read-only summary of a GameState for the hint rules.
 * Pure: reads the state, never mutates it, never touches the RNG.
 *
 * New code (not a port). Every field below names the C/engine field it reads;
 * identifiers were checked against src/engine/types.ts, src/engine/objects.ts,
 * src/data/constants.ts and src/data/dungeon.ts.
 */
import {
  BIRD,
  CAGE,
  CHEST,
  COND_ALLALIKE,
  COND_ALLDIFFERENT,
  DRAGON,
  DRAGON_BARS,
  GRATE,
  GRATE_OPEN,
  KEYS,
  LAMP,
  LAMP_BRIGHT,
  LOC_BUILDING,
  LOC_KINGHALL,
  LOC_NECHASM,
  LOC_NOWHERE,
  LOC_SECRET4,
  LOC_SECRET6,
  LOC_SWCHASM,
  NDWARVES,
  ROD,
  SNAKE,
  SNAKE_BLOCKS,
  TROLL,
  TROLL_GONE,
  CHASM,
  BRIDGE_WRECKED,
} from '../data/constants';
import { OBJECTS } from '../data/dungeon';
import { cndbit, indeep, isDarkHere, isHere, outside, toting } from '../engine/objects';
import type { GameState } from '../engine/index';

export type HintRegion = 'outside' | 'building' | 'underground';

export interface HintView {
  /** C: game.loc. */
  readonly loc: number;
  /** building: loc == LOC_BUILDING; outside: C OUTSIDE(loc); else underground. */
  readonly region: HintRegion;
  /** C: INDEEP(loc) (COND_DEEP). */
  readonly deep: boolean;
  /** C: IS_DARK_HERE(). */
  readonly dark: boolean;
  /** C: TOTING(LAMP). */
  readonly hasLamp: boolean;
  /** C: HERE(LAMP) (carried or on the floor). */
  readonly lampHere: boolean;
  /** objects[LAMP].prop == LAMP_BRIGHT. */
  readonly lampLit: boolean;
  /** game.lmwarn and game.limit >= 0: warned, still burning. */
  readonly lampLow: boolean;
  /** game.limit < 0: the lamp has run out. */
  readonly lampDead: boolean;
  /** C: TOTING(KEYS). */
  readonly hasKeys: boolean;
  /** C: TOTING(CAGE). */
  readonly hasCage: boolean;
  /** C: TOTING(ROD). */
  readonly hasRod: boolean;
  /** C: TOTING(BIRD). */
  readonly hasBird: boolean;
  /** objects[GRATE].prop == GRATE_OPEN. */
  readonly grateOpen: boolean;
  /** loc == LOC_KINGHALL and objects[SNAKE].prop == SNAKE_BLOCKS. */
  readonly snakeBlocks: boolean;
  /** loc is a dragon room (LOC_SECRET4/6) and objects[DRAGON].prop == DRAGON_BARS. */
  readonly dragonBars: boolean;
  /** loc is a chasm side (LOC_SWCHASM/NECHASM), troll not gone, bridge not wrecked. */
  readonly trollBlocks: boolean;
  /** loc is one of the maze rooms (COND_ALLALIKE or COND_ALLDIFFERENT). */
  readonly inMaze: boolean;
  /** dwarves[PIRATE].seen or chest stashed (objects[CHEST].place), and chest not yet in the building. */
  readonly pirateAbout: boolean;
  /** C: TOTING(CHEST). */
  readonly hasChest: boolean;
  /** Any treasure object (OBJECTS[i].isTreasure) is carried (place == CARRIED). */
  readonly carryingTreasure: boolean;
  /** Treasure total minus game.tally (tally counts treasures not yet found). */
  readonly treasuresFound: number;
  /** game.closng. */
  readonly closing: boolean;
}

/** C: CARRIED (advent.h). Not exported by the engine index. */
const CARRIED = -1;

/** Build the view. Pure; does not modify `state`. */
export function makeHintView(state: GameState): HintView {
  const g = state.game;
  const loc = g.loc;
  const region: HintRegion =
    loc === LOC_BUILDING ? 'building' : outside(loc) ? 'outside' : 'underground';

  let carryingTreasure = false;
  let treasureTotal = 0;
  const n = Math.min(OBJECTS.length, g.objects.length);
  for (let i = 1; i < n; i++) {
    if (OBJECTS[i]!.isTreasure) {
      treasureTotal += 1;
      if (g.objects[i]!.place === CARRIED) carryingTreasure = true;
    }
  }

  const chestPlace = g.objects[CHEST]!.place;
  return {
    loc,
    region,
    deep: indeep(loc),
    dark: isDarkHere(g),
    hasLamp: toting(g, LAMP),
    lampHere: isHere(g, LAMP),
    lampLit: g.objects[LAMP]!.prop === LAMP_BRIGHT,
    lampLow: g.lmwarn && g.limit >= 0,
    lampDead: g.limit < 0,
    hasKeys: toting(g, KEYS),
    hasCage: toting(g, CAGE),
    hasRod: toting(g, ROD),
    hasBird: toting(g, BIRD),
    grateOpen: g.objects[GRATE]!.prop === GRATE_OPEN,
    snakeBlocks: loc === LOC_KINGHALL && g.objects[SNAKE]!.prop === SNAKE_BLOCKS,
    dragonBars:
      (loc === LOC_SECRET4 || loc === LOC_SECRET6) && g.objects[DRAGON]!.prop === DRAGON_BARS,
    trollBlocks:
      (loc === LOC_SWCHASM || loc === LOC_NECHASM) &&
      g.objects[TROLL]!.prop !== TROLL_GONE &&
      g.objects[CHASM]!.prop !== BRIDGE_WRECKED,
    inMaze: cndbit(loc, COND_ALLALIKE) || cndbit(loc, COND_ALLDIFFERENT),
    pirateAbout:
      chestPlace !== LOC_BUILDING &&
      (g.dwarves[NDWARVES]!.seen || (chestPlace !== LOC_NOWHERE && chestPlace !== CARRIED)),
    hasChest: toting(g, CHEST),
    carryingTreasure,
    treasuresFound: treasureTotal - g.tally,
    closing: g.closng,
  };
}
