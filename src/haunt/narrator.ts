/**
 * The narrator picker. Deterministic: pool choice is a pure function of the
 * injected numeric seed, the moment key and how many times that key has fired.
 * It never uses Math.random or the engine RNG and never reads or writes
 * game.lcg_x.
 *
 * New code (not a port).
 */
import type { OutputEvent } from '../engine/index';
import {
  BACKTRACK_LINES,
  DRAGON_LINES,
  DWARF_LINES,
  FAREWELL_LINES,
  LAMP_DIM_LINES,
  LAMP_OUT_LINES,
  MAZE_LINES,
  PIRATE_LINES,
  REINCARNATED_LINES,
  REINCARNATION_COUNTDOWN,
  SPOKEN_XYZZY_LINES,
  TREASURE_LINES,
  deathPool,
} from './lines';
import {
  BYPASS_KINDS,
  PRIORITY,
  detectMoments,
  type Moment,
  type MomentKind,
  type TurnInfo,
} from './moments';

/** At most one regular narrator line per this many turns. */
export const COOLDOWN_TURNS = 3;

export interface NarratorOptions {
  /** Integer seed for the picker (not the engine seed). */
  readonly seed: number;
  /** Override the cooldown (default COOLDOWN_TURNS). */
  readonly cooldown?: number;
}

export interface Narrator {
  /** Narrator lines for one turn; call once per present(). Never throws on a valid turn. */
  lines(turn: TurnInfo, events: readonly OutputEvent[]): string[];
  /** A new game starts: clear cooldown and per-life limits (rotation is kept). */
  gameStart(): void;
  /** Clear everything, including the rotation counters. */
  reset(): void;
}

const REGULAR_POOLS: Readonly<Record<string, readonly string[]>> = {
  treasure: TREASURE_LINES,
  dwarf: DWARF_LINES,
  pirate: PIRATE_LINES,
  dragon: DRAGON_LINES,
  lampDim: LAMP_DIM_LINES,
  lampOut: LAMP_OUT_LINES,
  maze: MAZE_LINES,
  backtrack: BACKTRACK_LINES,
};

/** FNV-1a over UTF-16 code units; 32-bit safe. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** `pool[(hash(seed, key) + occurrence) % pool.length]`. */
export function pickIndex(seed: number, key: string, occurrence: number, length: number): number {
  return (hashString(`${seed | 0}:${key}`) + occurrence) % length;
}

export function createNarrator(options: NarratorOptions): Narrator {
  const seed = options.seed | 0;
  const cooldown = options.cooldown ?? COOLDOWN_TURNS;

  let turnCounter = 0;
  let lastFiredTurn = Number.NEGATIVE_INFINITY;
  let firedThisLife = new Set<MomentKind>();
  const occurrence = new Map<string, number>();

  function pick(key: string, pool: readonly string[]): string {
    const n = occurrence.get(key) ?? 0;
    occurrence.set(key, n + 1);
    return pool[pickIndex(seed, key, n, pool.length)] as string;
  }

  function bypassLines(m: Moment): string[] {
    switch (m.kind) {
      case 'death': {
        const { key, pool } = deathPool(m.deathGroup ?? 'other', m.deathCount ?? 1);
        return [pick(key, pool)];
      }
      case 'reincarnated':
        firedThisLife = new Set();
        return [REINCARNATION_COUNTDOWN, pick('reincarnated', REINCARNATED_LINES)];
      case 'declined':
        return [pick('declined', FAREWELL_LINES)];
      case 'spokenXyzzy':
        return [pick('spokenXyzzy', SPOKEN_XYZZY_LINES)];
      default:
        return [];
    }
  }

  function gameStart(): void {
    turnCounter = 0;
    lastFiredTurn = Number.NEGATIVE_INFINITY;
    firedThisLife = new Set();
  }

  return {
    lines(turn, events) {
      turnCounter += 1;
      const moments = detectMoments(turn, events);
      if (moments.length === 0) return [];

      const bypass = moments.filter((m) => BYPASS_KINDS.has(m.kind));
      if (bypass.length > 0) {
        // Death comes first, then the reincarnation or farewell, then reactions.
        const order: MomentKind[] = ['death', 'reincarnated', 'declined', 'spokenXyzzy'];
        bypass.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        const out: string[] = [];
        for (const m of bypass) out.push(...bypassLines(m));
        lastFiredTurn = turnCounter;
        return out;
      }

      if (turnCounter - lastFiredTurn < cooldown) return [];
      for (const kind of PRIORITY) {
        if (!moments.some((m) => m.kind === kind)) continue;
        if (firedThisLife.has(kind)) continue;
        firedThisLife.add(kind);
        lastFiredTurn = turnCounter;
        return [pick(kind, REGULAR_POOLS[kind] as readonly string[])];
      }
      return [];
    },

    gameStart,

    reset() {
      gameStart();
      occurrence.clear();
    },
  };
}
