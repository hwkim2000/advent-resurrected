// Fans one game-start notification out to independent loaders (voice-input
// spec, Requirement 13.8). A throwing handler never prevents the others.

import type { Logger, Mode } from './ui/types';

export function createGameStartFanOut(
  handlers: readonly ((mode: Mode) => void)[],
  log: Logger,
): (mode: Mode) => void {
  return (mode) => {
    for (const handler of handlers) {
      try {
        handler(mode);
      } catch (e) {
        log.error('game start handler failed', e);
      }
    }
  };
}
