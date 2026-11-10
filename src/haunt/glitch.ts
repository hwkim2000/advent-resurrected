/**
 * Policy for the "all alike" -> "all haunted" flash: glitch on the first maze
 * visit, then on every 4th. Pure counter, no timers.
 *
 * New code (not a port).
 */
export const GLITCH_EVERY = 4;

export interface GlitchPolicy {
  /** Call once per shown "all alike" block; true when the glitch should fire. */
  visit(): boolean;
  reset(): void;
}

export function createGlitchPolicy(every: number = GLITCH_EVERY): GlitchPolicy {
  let visits = 0;
  return {
    visit() {
      visits += 1;
      return (visits - 1) % every === 0;
    },
    reset() {
      visits = 0;
    },
  };
}
