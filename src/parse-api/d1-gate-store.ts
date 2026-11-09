/**
 * D1 implementation of the gate store (rate limit + daily cap).
 * New code. Structural types only, so no Cloudflare import is needed and the
 * same SQL runs on node:sqlite in tests.
 *
 * Parameters are numbered (?1..?5) and numbering is per statement.
 * Fallback if real D1 differs (spike item 14, checked in owner step 13):
 * use positional "?" only, and read each admit result from a
 * "SELECT changes()" placed directly after S1 and after S2 in the batch.
 */

import type { AdmitArgs, GateStore } from './gate';

export interface D1StatementLike {
  bind(...v: unknown[]): D1StatementLike;
  run(): Promise<{ meta: { changes: number } }>;
  first<T = unknown>(): Promise<T | null>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(s: D1StatementLike[]): Promise<{ meta: { changes: number } }[]>;
}

// S0: ensure the day row exists.
const S0 = 'INSERT OR IGNORE INTO daily(day, n) VALUES (?1, 0)';
// S1: count this request against the IP only if fewer than limit hits are in the window.
const S1 =
  'INSERT INTO hits(k, t, id) SELECT ?1, ?2, ?3 ' +
  'WHERE (SELECT COUNT(*) FROM hits WHERE k = ?1 AND t > ?4) < ?5';
// S2: reserve a daily slot only if S1 inserted our row and the cap is not reached.
const S2 =
  'UPDATE daily SET n = n + 1, last_id = ?3 ' +
  'WHERE day = ?1 AND n < ?2 ' +
  'AND EXISTS (SELECT 1 FROM hits WHERE k = ?4 AND t = ?5 AND id = ?3)';
// S3: if S1 counted the IP but S2 reserved nothing (cap reached), uncount the IP.
const S3 =
  'DELETE FROM hits WHERE k = ?1 AND t = ?2 AND id = ?3 ' +
  'AND NOT EXISTS (SELECT 1 FROM daily WHERE day = ?4 AND last_id = ?3)';
// S4: drop this IP's expired hits (primary-key prefix range).
const S4 = 'DELETE FROM hits WHERE k = ?1 AND t <= ?2';

const OLDEST = 'SELECT MIN(t) AS t FROM hits WHERE k = ?1 AND t > ?2';
const RELEASE = 'UPDATE daily SET n = n - 1 WHERE day = ?1 AND n > 0';
const SWEEP_HITS = 'DELETE FROM hits WHERE t <= ?1';
const SWEEP_DAILY = 'DELETE FROM daily WHERE day < ?1';

const IP_KEY_HEX_CHARS = 32;

export function d1GateStore(db: D1Like): GateStore {
  return {
    async admit(a: AdmitArgs): Promise<{ ip: boolean; slot: boolean }> {
      const since = a.nowMs - a.windowMs;
      const results = await db.batch([
        db.prepare(S0).bind(a.day),
        db.prepare(S1).bind(a.ipKey, a.nowMs, a.id, since, a.limit),
        db.prepare(S2).bind(a.day, a.cap, a.id, a.ipKey, a.nowMs),
        db.prepare(S3).bind(a.ipKey, a.nowMs, a.id, a.day),
        db.prepare(S4).bind(a.ipKey, since),
      ]);
      const s1 = results[1];
      const s2 = results[2];
      if (!s1 || !s2) throw new Error('gate batch returned too few results');
      return { ip: s1.meta.changes === 1, slot: s2.meta.changes === 1 };
    },

    async oldestInWindow(ipKey: string, sinceMs: number): Promise<number | null> {
      const row = await db.prepare(OLDEST).bind(ipKey, sinceMs).first<{ t: number | null }>();
      return row && typeof row.t === 'number' ? row.t : null;
    },

    async releaseSlot(day: string): Promise<void> {
      await db.prepare(RELEASE).bind(day).run();
    },

    async sweep(nowMs: number, windowMs: number, day: string): Promise<void> {
      await db.batch([
        db.prepare(SWEEP_HITS).bind(nowMs - windowMs),
        db.prepare(SWEEP_DAILY).bind(day),
      ]);
    },
  };
}

/** First 32 hex characters of SHA-256(salt + ":" + ip). The raw IP is never stored. */
export async function hashIpKey(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, IP_KEY_HEX_CHARS);
}
