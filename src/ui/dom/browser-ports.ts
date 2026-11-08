// Browser implementations of the UI ports: localStorage, Date.now, matchMedia, console.

import type { Clock, KeyValueStore, Logger, MotionPreference } from '../types';

const PROBE_KEY = 'advent:probe';

/**
 * Returns `localStorage` as a KeyValueStore, or `undefined` when it is blocked
 * or unusable (private mode, disabled cookies, quota 0). Probed with try/catch.
 */
export function createLocalStorageStore(): KeyValueStore | undefined {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return undefined;
    ls.setItem(PROBE_KEY, '1');
    ls.removeItem(PROBE_KEY);
    return {
      get: (key) => ls.getItem(key),
      set: (key, value) => ls.setItem(key, value),
      remove: (key) => ls.removeItem(key),
    };
  } catch {
    return undefined;
  }
}

export function createClock(): Clock {
  return { now: () => Date.now() };
}

/** Reads `prefers-reduced-motion` live; not reduced when matchMedia is unsupported. */
export function createMotionPreference(): MotionPreference {
  return {
    reduced(): boolean {
      try {
        if (typeof globalThis.matchMedia !== 'function') return false;
        return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    },
  };
}

export function createLogger(): Logger {
  return {
    error(message: string, cause?: unknown): void {
      if (cause === undefined) console.error(message);
      else console.error(message, cause);
    },
  };
}
