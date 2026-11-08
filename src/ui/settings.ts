// Settings_Record model for the CRT terminal UI.
// Pure and DOM-free. Reduced motion is never part of the record.

import type { Mode, Speed } from './types';

export interface Settings {
  mode: Mode;
  speed: Speed;
  crt: boolean;
}

export const DEFAULT_SETTINGS: Settings = { mode: 'haunted', speed: 120, crt: true };

export const SPEED_CHOICES: readonly Speed[] = [20, 60, 120, 300, 'instant'];

function isMode(v: unknown): v is Mode {
  return v === '1976' || v === 'haunted';
}

function isSpeed(v: unknown): v is Speed {
  return SPEED_CHOICES.includes(v as Speed);
}

/** Total parser: never throws; each missing or invalid field gets its default. */
export function parseSettings(text: string | null | undefined): Settings {
  let raw: unknown;
  try {
    raw = text === null || text === undefined ? undefined : JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const obj: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    mode: isMode(obj['mode']) ? obj['mode'] : DEFAULT_SETTINGS.mode,
    speed: isSpeed(obj['speed']) ? obj['speed'] : DEFAULT_SETTINGS.speed,
    crt: typeof obj['crt'] === 'boolean' ? obj['crt'] : DEFAULT_SETTINGS.crt,
  };
}

/** Printer with a fixed key order: mode, speed, crt. */
export function printSettings(s: Settings): string {
  return JSON.stringify({ mode: s.mode, speed: s.speed, crt: s.crt });
}
