// Lazy AI parser loading policy (ai-parser spec, Requirements 1.2 and 14). No
// reference to src/parser here: main.ts supplies the dynamic import().

import type { GameController } from './ui/game-controller';
import type { InputResolver } from './ui/input-resolver';
import type { Logger, Mode } from './ui/types';

export type AiParserModule = { createBrowserAiParser(log: Logger): InputResolver };

/**
 * Loads the AI parser chunk and installs it as the input resolver.
 * A failure is logged only; the game keeps the classic path with no player-visible message.
 */
export async function loadAiParser(
  ctl: GameController,
  log: Logger,
  load: () => Promise<AiParserModule>,
): Promise<void> {
  try {
    ctl.setInputResolver((await load()).createBrowserAiParser(log));
  } catch (e) {
    log.error('AI parser failed to load', e);
  }
}

/**
 * Returns the controller's game-start hook: loads the chunk the first time a
 * game starts in 'haunted' mode, never in '1976' mode, and at most once.
 */
export function createHauntedStartLoader(
  getController: () => GameController | undefined,
  log: Logger,
  load: () => Promise<AiParserModule>,
): (mode: Mode) => void {
  let started = false;
  return (mode) => {
    if (mode !== 'haunted' || started) return;
    const ctl = getController();
    if (ctl === undefined) return;
    started = true;
    // Lazy chunk, never awaited: the game does not wait for the AI parser.
    void loadAiParser(ctl, log, load);
  };
}
