// Command_History model for the CRT terminal UI (Requirement 8).
// Pure and immutable: every function returns a new state. No browser globals.

export const MAX_HISTORY = 100;
export const MAX_LINE = 1023;

export interface HistoryState {
  readonly entries: readonly string[];
  /** Index into `entries` while browsing; `null` means "not browsing". */
  readonly pos: number | null;
  /** Text the player had typed before browsing started. */
  readonly draft: string;
}

function capEntries(entries: readonly string[]): string[] {
  return entries.length > MAX_HISTORY ? entries.slice(entries.length - MAX_HISTORY) : entries.slice();
}

export function emptyHistory(entries: readonly string[] = []): HistoryState {
  return { entries: capEntries(entries), pos: null, draft: '' };
}

/**
 * Record a submitted line. Empty lines and lines equal to the newest entry are
 * not stored; the browsing position is always reset (8.1, 8.4, 8.5).
 */
export function pushLine(h: HistoryState, line: string): HistoryState {
  const text = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
  const newest = h.entries.length > 0 ? h.entries[h.entries.length - 1] : undefined;
  if (text === '' || text === newest) {
    return { entries: h.entries, pos: null, draft: '' };
  }
  return { entries: capEntries([...h.entries, text]), pos: null, draft: '' };
}

/** Up arrow: previous entry; stays on the oldest entry (8.2). */
export function recallUp(h: HistoryState, typed: string): { h: HistoryState; text: string } {
  if (h.entries.length === 0) return { h, text: typed };
  if (h.pos === null) {
    const pos = h.entries.length - 1;
    return { h: { entries: h.entries, pos, draft: typed }, text: h.entries[pos] as string };
  }
  const pos = Math.max(0, Math.min(h.pos, h.entries.length - 1) - 1);
  return { h: { entries: h.entries, pos, draft: h.draft }, text: h.entries[pos] as string };
}

/** Down arrow: next newer entry; past the newest, restore the draft (8.3). */
export function recallDown(h: HistoryState, typed: string): { h: HistoryState; text: string } {
  if (h.pos === null) return { h, text: typed };
  const next = h.pos + 1;
  if (next >= h.entries.length) {
    return { h: { entries: h.entries, pos: null, draft: '' }, text: h.draft };
  }
  return { h: { entries: h.entries, pos: next, draft: h.draft }, text: h.entries[next] as string };
}

/** Total parser: anything but a JSON array of strings gives [] (8.8). */
export function parseHistory(text: string | null): string[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  if (!value.every((v) => typeof v === 'string')) return [];
  const lines = (value as string[]).filter((v) => v !== '' && v.length <= MAX_LINE);
  return capEntries(lines);
}

export function printHistory(entries: readonly string[]): string {
  return JSON.stringify(capEntries(entries));
}
