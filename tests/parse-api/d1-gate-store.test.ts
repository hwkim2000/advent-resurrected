/**
 * Rate-limit and daily-cap SQL tests (task 6.8). The real gate statements run on
 * node:sqlite through NodeSqliteD1. No network, no wall clock.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { admit, utcDay } from '../../src/parse-api/gate';
import type { AdmitDecision } from '../../src/parse-api/gate';
import { readConfig } from '../../src/parse-api/config';
import type { ParseConfig } from '../../src/parse-api/config';
import { d1GateStore, hashIpKey } from '../../src/parse-api/d1-gate-store';
import { handleParse } from '../../src/parse-api/handler';
import {
  FakeProvider,
  NodeSqliteD1,
  TEST_IP,
  makeDeps,
  makeEnv,
  makeRequest,
} from '../support/ai-fakes';

const IP_KEY = 'k-test-ip';
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);
const WINDOW_MS = 60_000;

let db: NodeSqliteD1;
let seq = 0;

beforeEach(() => {
  db = new NodeSqliteD1();
  seq = 0;
});
afterEach(() => {
  db.close();
});

function cfg(over: Record<string, unknown> = {}): ParseConfig {
  return readConfig(makeEnv({ DAILY_CAP: '100000', ...over }));
}

function ask(
  config: ParseConfig,
  nowMs: number,
  ipKey = IP_KEY,
): Promise<AdmitDecision> {
  seq += 1;
  return admit(d1GateStore(db), { ipKey, id: `id-${seq}`, nowMs, cfg: config });
}

async function fill(config: ParseConfig, count: number, nowMs: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const d = await ask(config, nowMs);
    expect(d.kind).toBe('admitted');
  }
}

function snapshot(): string {
  return JSON.stringify({ hits: db.hitRows(), daily: db.dailyRows() });
}

describe('sliding window (per-IP rate limit)', () => {
  it('admits exactly 30 requests at t=0 and rejects the 31st', async () => {
    const c = cfg();
    await fill(c, 30, T0);
    const d = await ask(c, T0);
    expect(d).toEqual({ kind: 'rate_limited', retryAfterSec: 60 });
    expect(db.hitRows()).toHaveLength(30); // the rejected request is not counted
  });

  it.each([
    [0, 'rate_limited'],
    [1_000, 'rate_limited'],
    [59_000, 'rate_limited'],
    [59_999, 'rate_limited'],
    [60_000, 'admitted'],
    [61_000, 'admitted'],
  ])('with 30 hits at t=0, a request at +%i ms is %s (half-open window)', async (offset, kind) => {
    const c = cfg();
    await fill(c, 30, T0);
    const d = await ask(c, T0 + offset);
    expect(d.kind).toBe(kind);
  });

  it('gives a Retry-After from 1 to 60 and admits a request at that time', async () => {
    for (const offset of [0, 1, 29_500, 59_000, 59_500, 59_999]) {
      db.close();
      db = new NodeSqliteD1();
      const c = cfg();
      await fill(c, 30, T0);
      const d = await ask(c, T0 + offset);
      expect(d.kind).toBe('rate_limited');
      if (d.kind !== 'rate_limited') return;
      expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(d.retryAfterSec).toBeLessThanOrEqual(60);
      expect(d.retryAfterSec).toBe(Math.ceil((WINDOW_MS - offset) / 1000));
      const later = await ask(c, T0 + offset + d.retryAfterSec * 1000);
      expect(later.kind).toBe('admitted');
    }
  });

  it('uses the oldest hit in the window for oldestInWindow and Retry-After', async () => {
    const c = cfg();
    // One hit per second, 30 hits: t = 0 .. 29 s.
    for (let i = 0; i < 30; i += 1) await ask(c, T0 + i * 1000);
    const store = d1GateStore(db);
    expect(await store.oldestInWindow(IP_KEY, T0 + 30_000 - WINDOW_MS)).toBe(T0);
    expect(await store.oldestInWindow(IP_KEY, T0 + 60_000 - WINDOW_MS)).toBe(T0 + 1000);
    expect(await store.oldestInWindow('other', T0 - 1)).toBeNull();

    const d = await ask(c, T0 + 30_000);
    expect(d).toEqual({ kind: 'rate_limited', retryAfterSec: 30 });
    expect((await ask(c, T0 + 60_000)).kind).toBe('admitted');
  });

  it('keeps separate windows per IP key', async () => {
    const c = cfg();
    await fill(c, 30, T0);
    expect((await ask(c, T0, 'someone-else')).kind).toBe('admitted');
  });

  it('honors a configured limit and window', async () => {
    const c = cfg({ RATE_LIMIT: '2', RATE_WINDOW_SECONDS: '10' });
    await fill(c, 2, T0);
    expect((await ask(c, T0 + 9_000)).kind).toBe('rate_limited');
    expect((await ask(c, T0 + 10_000)).kind).toBe('admitted');
  });
});

describe('exact daily cap', () => {
  it('reserves exactly N slots; request N+1 is capped and not counted against the IP', async () => {
    const cap = 5;
    const c = cfg({ DAILY_CAP: String(cap) });
    await fill(c, cap, T0);
    expect(db.dailyRows()).toEqual([
      expect.objectContaining({ day: utcDay(T0), n: cap }),
    ]);

    const capped = await ask(c, T0 + 1);
    expect(capped).toEqual({ kind: 'capped' });
    expect(db.dailyRows()[0]?.n).toBe(cap);
    // S3: the capped request left no hit behind.
    expect(db.hitRows()).toHaveLength(cap);
    expect(await d1GateStore(db).oldestInWindow(IP_KEY, T0 - 1)).toBe(T0);

    // It stays capped for other IPs too.
    expect(await ask(c, T0 + 2, 'another-ip')).toEqual({ kind: 'capped' });
    expect(db.hitRows().filter((h) => h.k === 'another-ip')).toHaveLength(0);
    expect(db.dailyRows()[0]?.n).toBe(cap);
  });

  it('a capped request does not consume the IP rate-limit budget', async () => {
    const c = cfg({ DAILY_CAP: '1', RATE_LIMIT: '2' });
    expect((await ask(c, T0)).kind).toBe('admitted');
    for (let i = 0; i < 10; i += 1) expect(await ask(c, T0 + 1 + i)).toEqual({ kind: 'capped' });
    // Still one hit only, so the IP is never rate limited by capped traffic.
    expect(db.hitRows()).toHaveLength(1);
  });

  it('resets the count at midnight UTC', async () => {
    const c = cfg({ DAILY_CAP: '2' });
    const lastSecond = Date.UTC(2026, 0, 15, 23, 59, 58);
    const nextDay = Date.UTC(2026, 0, 16, 0, 0, 0);
    expect(utcDay(lastSecond)).toBe('2026-01-15');
    expect(utcDay(nextDay)).toBe('2026-01-16');

    expect((await ask(c, lastSecond)).kind).toBe('admitted');
    expect((await ask(c, lastSecond + 1)).kind).toBe('admitted');
    expect(await ask(c, lastSecond + 1)).toEqual({ kind: 'capped' });

    const d = await ask(c, nextDay);
    expect(d).toEqual({ kind: 'admitted', day: '2026-01-16' });
    expect(db.dailyRows().map((r) => [r.day, r.n])).toEqual([
      ['2026-01-15', 2],
      ['2026-01-16', 1],
    ]);
  });

  it('a missing, zero or invalid cap admits nothing and never touches the store', async () => {
    for (const bad of [undefined, '0', '', 'abc', '-1', '1000000000']) {
      const env = makeEnv();
      if (bad === undefined) delete env['DAILY_CAP'];
      else env['DAILY_CAP'] = bad;
      const c = readConfig(env);
      expect(c.dailyCap).toBeUndefined();
      expect(await ask(c, T0)).toEqual({ kind: 'capped' });
    }
    expect(db.hitRows()).toEqual([]);
    expect(db.dailyRows()).toEqual([]);
  });

  it('the store itself reserves nothing when called with cap 0', async () => {
    const r = await d1GateStore(db).admit({
      ipKey: IP_KEY,
      id: 'zero',
      nowMs: T0,
      windowMs: WINDOW_MS,
      limit: 30,
      day: utcDay(T0),
      cap: 0,
    });
    expect(r).toEqual({ ip: true, slot: false });
    expect(db.hitRows()).toEqual([]);
    expect(db.dailyRows().map((x) => x.n)).toEqual([0]);
  });

  it('rate limit is checked first: a rate-limited request does not take a slot', async () => {
    const c = cfg({ DAILY_CAP: '100', RATE_LIMIT: '3' });
    await fill(c, 3, T0);
    expect((await ask(c, T0)).kind).toBe('rate_limited');
    expect(db.dailyRows()[0]?.n).toBe(3);
  });
});

describe('rollback on failure', () => {
  async function seed(): Promise<void> {
    const c = cfg({ DAILY_CAP: '100' });
    await fill(c, 3, T0 - 10_000);
  }

  it.each([0, 1, 2, 3, 4])(
    'a failure at batch statement %i leaves hits and daily unchanged and admit returns unavailable',
    async (statement) => {
      await seed();
      const before = snapshot();
      db.resetCalls();
      db.injectFault({ call: 1, statement });
      const d = await ask(cfg({ DAILY_CAP: '100' }), T0);
      expect(d).toEqual({ kind: 'unavailable' });
      expect(db.rollbacks).toBe(1);
      expect(snapshot()).toBe(before);
    },
  );

  it('also rolls back on a fresh day (the S0 day row is not left behind)', async () => {
    db.injectFault({ call: 1, statement: 2 });
    expect(await ask(cfg(), T0)).toEqual({ kind: 'unavailable' });
    expect(db.hitRows()).toEqual([]);
    expect(db.dailyRows()).toEqual([]);
  });

  it('a whole-call failure returns unavailable and changes nothing', async () => {
    await seed();
    const before = snapshot();
    db.resetCalls();
    db.injectFault({ call: 1 });
    expect(await ask(cfg({ DAILY_CAP: '100' }), T0)).toEqual({ kind: 'unavailable' });
    expect(snapshot()).toBe(before);
  });

  it('recovers on the next request after a failure', async () => {
    db.injectFault({ call: 1, statement: 3 });
    expect((await ask(cfg(), T0)).kind).toBe('unavailable');
    expect((await ask(cfg(), T0)).kind).toBe('admitted');
    expect(db.hitRows()).toHaveLength(1);
    expect(db.dailyRows()[0]?.n).toBe(1);
  });

  it.each([0, 1, 2, 3, 4])(
    'through handleParse, a failure at statement %i answers 503 and the provider is never called',
    async (statement) => {
      const provider = new FakeProvider({ script: [{ kind: 'output', value: 'LOOK' }] });
      const { deps } = makeDeps({ provider, store: d1GateStore(db) });
      db.injectFault({ call: 1, statement });
      const res = await handleParse(makeRequest(), makeEnv(), deps);
      expect(res.status).toBe(503);
      expect(provider.calls).toBe(0);
      expect(db.hitRows()).toEqual([]);
      expect(db.dailyRows()).toEqual([]);
    },
  );
});

describe('releaseSlot, sweep and key privacy', () => {
  it('releaseSlot decrements and never goes below zero', async () => {
    const c = cfg({ DAILY_CAP: '10' });
    const store = d1GateStore(db);
    const day = utcDay(T0);
    await fill(c, 2, T0);
    await store.releaseSlot(day);
    expect(db.dailyRows()[0]?.n).toBe(1);
    await store.releaseSlot(day);
    await store.releaseSlot(day);
    await store.releaseSlot(day);
    expect(db.dailyRows()[0]?.n).toBe(0);
    await store.releaseSlot('2000-01-01'); // unknown day: no row created, no error
    expect(db.dailyRows().map((r) => r.day)).toEqual([day]);
  });

  it('a released slot can be used again under the cap', async () => {
    const c = cfg({ DAILY_CAP: '1' });
    expect((await ask(c, T0)).kind).toBe('admitted');
    expect((await ask(c, T0 + 1)).kind).toBe('capped');
    await d1GateStore(db).releaseSlot(utcDay(T0));
    expect((await ask(c, T0 + 2)).kind).toBe('admitted');
  });

  it('sweep removes expired hits and old days and keeps current ones', async () => {
    const store = d1GateStore(db);
    const c = cfg();
    const yesterday = T0 - 24 * 3600 * 1000;
    await ask(c, yesterday); // old day, old hit
    await ask(c, T0 - 60_000); // exactly expired (t <= now - window)
    await ask(c, T0 - 59_999); // still in window
    await ask(c, T0); // current
    await store.sweep(T0, WINDOW_MS, utcDay(T0));
    expect(db.hitRows().map((h) => h.t)).toEqual([T0 - 59_999, T0]);
    expect(db.dailyRows().map((r) => r.day)).toEqual([utcDay(T0)]);
  });

  it('stores only the hashed key, never the raw IP', async () => {
    const provider = new FakeProvider({ script: [{ kind: 'output', value: 'LOOK' }] });
    const { deps } = makeDeps({ provider, store: d1GateStore(db) });
    const env = makeEnv();
    const res = await handleParse(makeRequest(), env, deps);
    expect(res.status).toBe(200);

    const expectedKey = await hashIpKey(TEST_IP, 'test-salt');
    expect(expectedKey).toMatch(/^[0-9a-f]{32}$/);
    const rows = db.hitRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.k).toBe(expectedKey);

    const everything = JSON.stringify({ hits: rows, daily: db.dailyRows() });
    expect(everything).not.toContain(TEST_IP);
    expect(everything).not.toContain('test-salt');
  });
});
