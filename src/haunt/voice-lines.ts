/**
 * Voice_Lines: every fixed narrator-voice text, normalized, with a stable
 * Voice_Key that names its pre-generated audio file.
 *
 * New code (not a port). Shared by scripts/gen-voice.ts and the player.
 */
import {
  ALL_POOLS,
  REINCARNATION_COUNTDOWN,
} from './lines';
import { DEFLECTION_LINE } from './spoken-word-rule';
import { NUDGE_LINES } from './yes-no';

/** Trim and collapse all whitespace runs (including newlines) to one space. */
export function normalizeVoiceLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** FNV-1a 32-bit over the UTF-16 code units of the normalized text, 8 hex chars. */
export function voiceKey(text: string): string {
  const s = normalizeVoiceLine(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Unique, sorted, normalized list of every narrator-voice line. */
export function voiceLines(): readonly string[] {
  const all: string[] = [REINCARNATION_COUNTDOWN, DEFLECTION_LINE, ...NUDGE_LINES];
  for (const pool of Object.values(ALL_POOLS)) all.push(...pool);
  const unique = new Set(all.map(normalizeVoiceLine).filter((l) => l.length > 0));
  return [...unique].sort();
}
