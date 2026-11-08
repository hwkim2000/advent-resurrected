// Adapter from the engine's synchronous Storage interface to a KeyValueStore.

import type { Storage } from '../engine/index';
import type { KeyValueStore } from './types';

/** Prefix for player-chosen SAVE/RESUME file names. */
export const FILE_PREFIX = 'advent:file:';
/** Reserved keys; none starts with FILE_PREFIX, so no file name can overwrite them. */
export const AUTOSAVE_KEY = 'advent:autosave';
export const SETTINGS_KEY = 'advent:settings';
export const HISTORY_KEY = 'advent:history';

export class SaveStore implements Storage {
  constructor(private readonly kv: KeyValueStore) {}

  /** Returns the stored text, or undefined when absent or when reading throws. */
  read(name: string): string | undefined {
    try {
      const v = this.kv.get(FILE_PREFIX + name);
      return v === null || v === undefined ? undefined : v;
    } catch {
      return undefined;
    }
  }

  /** Returns false when the underlying write throws. */
  write(name: string, data: string): boolean {
    try {
      this.kv.set(FILE_PREFIX + name, data);
      return true;
    } catch {
      return false;
    }
  }
}
