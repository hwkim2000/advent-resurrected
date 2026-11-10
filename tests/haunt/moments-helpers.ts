import type { Moment } from '../../src/haunt/moments';

/** C: CARRIED (advent.h) = -1; the engine index does not export it. */
export const CARRIED_PLACE_FOR_TESTS = -1;

export function kindsOf(moments: readonly Moment[]): string[] {
  return moments.map((m) => m.kind);
}
