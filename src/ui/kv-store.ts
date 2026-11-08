// Key-value stores for the CRT terminal UI. Pure: the real localStorage is
// injected from src/ui/dom/browser-ports.ts.

import type { KeyValueStore } from './types';

/** Map-backed store. Never throws. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    const v = this.map.get(key);
    return v === undefined ? null : v;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

/**
 * Wraps a primary store (e.g. localStorage) that may be missing or may throw.
 * When the primary fails, values are kept in memory for the page's lifetime and
 * `onDegraded` is called exactly once. No method ever throws.
 */
export class ResilientStore implements KeyValueStore {
  private readonly memory = new Map<string, string>();
  private degraded = false;

  constructor(
    private readonly primary: KeyValueStore | undefined,
    private readonly onDegraded: () => void,
  ) {}

  private markDegraded(): void {
    if (this.degraded) return;
    this.degraded = true;
    try {
      this.onDegraded();
    } catch {
      // The notice callback must never break storage.
    }
  }

  get(key: string): string | null {
    const mem = this.memory.get(key);
    if (mem !== undefined) return mem;
    if (this.primary === undefined) return null;
    try {
      return this.primary.get(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    if (this.primary === undefined) {
      this.memory.set(key, value);
      this.markDegraded();
      return;
    }
    try {
      this.primary.set(key, value);
      // The primary holds the newest value; drop any stale in-memory copy.
      this.memory.delete(key);
    } catch {
      this.memory.set(key, value);
      this.markDegraded();
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    if (this.primary === undefined) return;
    try {
      this.primary.remove(key);
    } catch {
      // Nothing more can be done; the memory copy is already gone.
    }
  }
}
