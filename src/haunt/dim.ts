/**
 * Lamp-driven screen dimming. Pure. `limit` is the lamp life in turns
 * (C: game.limit); the lamp is on when objects[LAMP].prop is LAMP_BRIGHT.
 *
 * New code (not a port).
 */
import { LAMP, LAMP_BRIGHT } from '../data/constants';
import type { Game } from '../engine/index';

/** Below this much lamp life the screen starts to dim. */
export const DIM_START = 150;
/** Lowest brightness; keeps normal text at or above 4.5:1 contrast. */
export const DIM_FLOOR = 0.6;

/**
 * Brightness multiplier in [DIM_FLOOR, 1]. 1 while the lamp is off or healthy;
 * falls linearly from 1 at `limit` DIM_START to DIM_FLOOR at `limit` 0. A dead
 * lamp (limit 0 or -1, the engine sets -1 when it runs out) gives the floor.
 * Fresh batteries raise `limit`, so the level recovers on its own.
 */
export function dimLevelForLimit(limit: number, lampOn: boolean): number {
  if (!Number.isFinite(limit)) return 1;
  if (limit <= 0) return DIM_FLOOR;
  if (!lampOn || limit > DIM_START) return 1;
  return 1 - (1 - DIM_FLOOR) * (1 - limit / DIM_START);
}

export function dimLevel(game: Pick<Game, 'limit' | 'objects'>): number {
  const lamp = game.objects[LAMP];
  return dimLevelForLimit(game.limit, lamp !== undefined && lamp.prop === LAMP_BRIGHT);
}
