// Boot sequence data for the CRT terminal UI. Data only: no DOM, no timers.
// The controller enqueues each line as a Teletype block at BOOT_CPS.
// Avoids third-party product names (no DEC, TOPS-10, ...).

export interface BootLine {
  readonly text: string;
  readonly pauseAfterMs: number;
}

/** Fixed boot reveal rate in characters per second, independent of Typing_Speed. */
export const BOOT_CPS = 30;

export const FULL_BOOT: readonly BootLine[] = [
  { text: 'PDP-10 CPU 0 ONLINE', pauseAfterMs: 100 },
  { text: 'MEMORY CHECK ... 256K WORDS ... OK', pauseAfterMs: 100 },
  { text: 'MOUNTING TAPE UNIT 0 ... DONE', pauseAfterMs: 200 },
  { text: 'LOADING ADVENT ... FAILED', pauseAfterMs: 700 },
  { text: 'RETRYING AFTER 49 YEARS ...', pauseAfterMs: 500 },
  { text: 'RESURRECTING', pauseAfterMs: 0 },
];

export const SHORT_BOOT: readonly BootLine[] = [
  { text: 'RETRYING AFTER 49 YEARS ...', pauseAfterMs: 150 },
  { text: 'RESURRECTING', pauseAfterMs: 0 },
];

/** Short boot when a valid Autosave exists, otherwise the full boot. */
export function selectBoot(hasValidAutosave: boolean): readonly BootLine[] {
  return hasValidAutosave ? SHORT_BOOT : FULL_BOOT;
}

/** Unskipped duration: characters (each line plus its newline) at BOOT_CPS, plus pauses. */
export function bootDurationMs(script: readonly BootLine[]): number {
  let chars = 0;
  let pauses = 0;
  for (const line of script) {
    chars += Array.from(line.text).length + 1;
    pauses += line.pauseAfterMs;
  }
  return (chars / BOOT_CPS) * 1000 + pauses;
}
