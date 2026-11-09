/**
 * Rate limit and daily cap orchestration for the parse endpoint.
 * New code (not a port of Open Adventure). The store is injected so tests can
 * use in-memory doubles and real SQL on node:sqlite.
 */

import type { ParseConfig } from './config';

export interface AdmitArgs {
  /** Salted hash of the client IP (never the raw IP). */
  ipKey: string;
  /** Unique id of this request. */
  id: string;
  nowMs: number;
  windowMs: number;
  /** Maximum hits per IP in the window. */
  limit: number;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** Daily cap on provider-bound requests. */
  cap: number;
}

export interface GateStore {
  /**
   * One atomic unit. ip: this request was counted against the IP window.
   * slot: a daily slot was reserved (implies ip).
   */
  admit(a: AdmitArgs): Promise<{ ip: boolean; slot: boolean }>;
  /** Oldest hit time (ms) of this IP with t > sinceMs, or null if none. */
  oldestInWindow(ipKey: string, sinceMs: number): Promise<number | null>;
  releaseSlot(day: string): Promise<void>;
  sweep(nowMs: number, windowMs: number, day: string): Promise<void>;
}

export type AdmitDecision =
  | { kind: 'admitted'; day: string }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'capped' }
  | { kind: 'unavailable' };

const MAX_RETRY_AFTER_S = 60;

/** UTC day as YYYY-MM-DD. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Decide whether a request may proceed. The window is half-open: a hit at
 * time h counts at time t while h > t - windowMs.
 */
export async function admit(
  store: GateStore,
  p: { ipKey: string; id: string; nowMs: number; cfg: ParseConfig },
): Promise<AdmitDecision> {
  const { cfg, nowMs } = p;
  if (cfg.dailyCap === undefined) return { kind: 'capped' };

  const day = utcDay(nowMs);
  let result: { ip: boolean; slot: boolean };
  try {
    result = await store.admit({
      ipKey: p.ipKey,
      id: p.id,
      nowMs,
      windowMs: cfg.rateWindowMs,
      limit: cfg.rateLimit,
      day,
      cap: cfg.dailyCap,
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (!result.ip) {
    let retryAfterSec = MAX_RETRY_AFTER_S;
    try {
      const oldest = await store.oldestInWindow(p.ipKey, nowMs - cfg.rateWindowMs);
      if (oldest !== null) {
        retryAfterSec = clamp(
          Math.ceil((oldest + cfg.rateWindowMs - nowMs) / 1000),
          1,
          MAX_RETRY_AFTER_S,
        );
      }
    } catch {
      retryAfterSec = MAX_RETRY_AFTER_S;
    }
    return { kind: 'rate_limited', retryAfterSec };
  }
  if (!result.slot) return { kind: 'capped' };
  return { kind: 'admitted', day };
}
