/**
 * Browser wiring for the AI parser: binds window.fetch, performance.now,
 * timers and navigator.onLine. New code; not ported from Open Adventure.
 */
import { AiParser } from './ai-parser';

export function createBrowserAiParser(log: { error(message: string, cause?: unknown): void }): AiParser {
  return new AiParser({
    fetch: (input, init) => window.fetch(input, init),
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    isOnline: () => navigator.onLine,
    log,
  });
}
