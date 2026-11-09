/**
 * Server-side test doubles for the ai-parser spec (task 6.7).
 * FakeProvider, MemoryGateStore, NonAtomicGateStore, NodeSqliteD1 and request/deps helpers.
 * No network, no wall clock: time, ids and timers are injected.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ParseDeps } from '../../src/parse-api/handler';
import type { AdmitArgs, GateStore } from '../../src/parse-api/gate';
import type { D1Like, D1StatementLike } from '../../src/parse-api/d1-gate-store';
import { hashIpKey } from '../../src/parse-api/d1-gate-store';
import type { Provider, ProviderInput } from '../../src/parse-api/provider';

/* ------------------------------------------------------------------ */
/* FakeProvider                                                        */
/* ------------------------------------------------------------------ */

export type ProviderStep =
  | { kind: 'output'; value: unknown }
  | { kind: 'throw'; error?: Error }
  | { kind: 'hang' };

export interface FakeProviderOptions {
  /** Steps consumed in order; the last step repeats. Default: output `NOCOMMAND`. */
  script?: ProviderStep[];
  /**
   * Simulates a model that obeys an injection: the answer is the raw
   * `player_text` taken from the user message, so the validator must reject it.
   */
  obeyInjection?: boolean;
}

export class FakeProvider implements Provider {
  calls = 0;
  inputs: ProviderInput[] = [];
  aborted = 0;
  private script: ProviderStep[];
  private readonly obey: boolean;

  constructor(opts: FakeProviderOptions = {}) {
    this.script = opts.script ?? [{ kind: 'output', value: 'NOCOMMAND' }];
    this.obey = opts.obeyInjection ?? false;
  }

  /** Always answers with `value` (any type, to test non-string output). */
  static answering(value: unknown): FakeProvider {
    return new FakeProvider({ script: [{ kind: 'output', value }] });
  }
  static failing(error?: Error): FakeProvider {
    return new FakeProvider({ script: [{ kind: 'throw', ...(error ? { error } : {}) }] });
  }
  static hanging(): FakeProvider {
    return new FakeProvider({ script: [{ kind: 'hang' }] });
  }
  static obeying(): FakeProvider {
    return new FakeProvider({ obeyInjection: true });
  }

  get lastInput(): ProviderInput | undefined {
    return this.inputs[this.inputs.length - 1];
  }

  translate(input: ProviderInput): Promise<unknown> {
    const index = this.calls;
    this.calls += 1;
    this.inputs.push(input);
    input.signal.addEventListener('abort', () => {
      this.aborted += 1;
    });
    if (this.obey) {
      let text: unknown;
      try {
        text = (JSON.parse(input.user) as { player_text?: unknown }).player_text;
      } catch {
        text = input.user;
      }
      return Promise.resolve(text);
    }
    const step = this.script[Math.min(index, this.script.length - 1)];
    if (!step) return Promise.resolve('NOCOMMAND');
    switch (step.kind) {
      case 'output':
        return Promise.resolve(step.value);
      case 'throw':
        return Promise.reject(step.error ?? new Error('fake provider failure'));
      case 'hang':
        return new Promise<unknown>(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ */
/* In-memory gate stores                                               */
/* ------------------------------------------------------------------ */

/** Injected scheduler: called at suspension points so tests can interleave callers. */
export type YieldFn = () => Promise<void>;
const defaultYield: YieldFn = () => Promise.resolve();

interface Hit {
  k: string;
  t: number;
  id: string;
}

abstract class BaseMemoryStore implements GateStore {
  hits: Hit[] = [];
  daily = new Map<string, { n: number; lastId: string | null }>();
  failAdmit = false;

  constructor(protected readonly yieldFn: YieldFn = defaultYield) {}

  abstract admit(a: AdmitArgs): Promise<{ ip: boolean; slot: boolean }>;

  async oldestInWindow(ipKey: string, sinceMs: number): Promise<number | null> {
    let min: number | null = null;
    for (const h of this.hits) {
      if (h.k === ipKey && h.t > sinceMs && (min === null || h.t < min)) min = h.t;
    }
    return min;
  }

  async releaseSlot(day: string): Promise<void> {
    const row = this.daily.get(day);
    if (row && row.n > 0) row.n -= 1;
  }

  async sweep(nowMs: number, windowMs: number, day: string): Promise<void> {
    this.hits = this.hits.filter((h) => h.t > nowMs - windowMs);
    for (const d of [...this.daily.keys()]) if (d < day) this.daily.delete(d);
  }

  dailyCount(day: string): number {
    return this.daily.get(day)?.n ?? 0;
  }
  hitCount(ipKey: string): number {
    return this.hits.filter((h) => h.k === ipKey).length;
  }
}

/** Atomic admit: the whole decision runs without an await in between. */
export class MemoryGateStore extends BaseMemoryStore {
  async admit(a: AdmitArgs): Promise<{ ip: boolean; slot: boolean }> {
    await this.yieldFn(); // interleaving point before the atomic section
    if (this.failAdmit) throw new Error('memory store failure');
    const since = a.nowMs - a.windowMs;
    this.hits = this.hits.filter((h) => !(h.k === a.ipKey && h.t <= since));
    const inWindow = this.hits.filter((h) => h.k === a.ipKey && h.t > since).length;
    if (inWindow >= a.limit) return { ip: false, slot: false };
    const row = this.daily.get(a.day) ?? { n: 0, lastId: null };
    this.daily.set(a.day, row);
    if (row.n >= a.cap) return { ip: true, slot: false }; // IP uncounted (S3)
    this.hits.push({ k: a.ipKey, t: a.nowMs, id: a.id });
    row.n += 1;
    row.lastId = a.id;
    return { ip: true, slot: true };
  }
}

/**
 * Negative control: reads the counters, yields, then writes. Concurrent
 * callers overshoot the cap and the rate limit, which proves the cap
 * property can fail on a racy store.
 */
export class NonAtomicGateStore extends BaseMemoryStore {
  async admit(a: AdmitArgs): Promise<{ ip: boolean; slot: boolean }> {
    const since = a.nowMs - a.windowMs;
    const inWindow = this.hits.filter((h) => h.k === a.ipKey && h.t > since).length;
    const n = this.daily.get(a.day)?.n ?? 0;
    await this.yieldFn(); // the race window
    if (inWindow >= a.limit) return { ip: false, slot: false };
    if (n >= a.cap) return { ip: true, slot: false };
    this.hits.push({ k: a.ipKey, t: a.nowMs, id: a.id });
    this.daily.set(a.day, { n: (this.daily.get(a.day)?.n ?? 0) + 1, lastId: a.id });
    return { ip: true, slot: true };
  }
}

/* ------------------------------------------------------------------ */
/* NodeSqliteD1                                                        */
/* ------------------------------------------------------------------ */

export interface D1Fault {
  /** 1-based index of the D1 operation (batch, run or first) since construction/reset. */
  call: number;
  /**
   * For a batch: 0-based statement index that throws after the earlier
   * statements ran (so ROLLBACK is exercised). Omitted: the call throws first.
   */
  statement?: number;
}

type SqlValue = null | number | bigint | string;

const MIGRATION_PATH = new URL('../../migrations/0001_gate.sql', import.meta.url);

class Stmt implements D1StatementLike {
  params: SqlValue[] = [];
  constructor(
    readonly owner: NodeSqliteD1,
    readonly sql: string,
  ) {}

  bind(...v: unknown[]): D1StatementLike {
    this.params = v.map((x) => {
      if (x === null || x === undefined) return null;
      if (typeof x === 'number' || typeof x === 'bigint' || typeof x === 'string') return x;
      if (typeof x === 'boolean') return x ? 1 : 0;
      throw new Error('unsupported bind value');
    });
    return this;
  }

  execute(): { changes: number } {
    const r = this.owner.db.prepare(this.sql).run(...this.params);
    return { changes: Number(r.changes) };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    this.owner.beginCall();
    return { meta: this.execute() };
  }

  async first<T = unknown>(): Promise<T | null> {
    this.owner.beginCall();
    const row = this.owner.db.prepare(this.sql).get(...this.params);
    return (row ?? null) as T | null;
  }
}

/** A `D1Like` over node:sqlite with fault injection. Applies the gate migration. */
export class NodeSqliteD1 implements D1Like {
  readonly db: DatabaseSync;
  private calls = 0;
  private faults: D1Fault[] = [];
  /** Number of batches rolled back. */
  rollbacks = 0;

  constructor(opts: { migrate?: boolean } = {}) {
    this.db = new DatabaseSync(':memory:');
    if (opts.migrate !== false) this.db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  }

  injectFault(f: D1Fault): void {
    this.faults.push(f);
  }
  clearFaults(): void {
    this.faults = [];
  }
  resetCalls(): void {
    this.calls = 0;
  }

  /** Throws when a call-level fault (no statement index) matches this call. */
  beginCall(): void {
    this.calls += 1;
    const f = this.faults.find((x) => x.call === this.calls && x.statement === undefined);
    if (f) throw new Error('injected D1 failure');
  }

  prepare(sql: string): D1StatementLike {
    return new Stmt(this, sql);
  }

  async batch(statements: D1StatementLike[]): Promise<{ meta: { changes: number } }[]> {
    this.beginCall();
    const fault = this.faults.find((x) => x.call === this.calls && x.statement !== undefined);
    this.db.exec('BEGIN');
    const out: { meta: { changes: number } }[] = [];
    try {
      statements.forEach((s, i) => {
        if (fault && fault.statement === i) throw new Error('injected D1 statement failure');
        if (!(s instanceof Stmt)) throw new Error('foreign statement');
        out.push({ meta: s.execute() });
      });
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.rollbacks += 1;
      throw e;
    }
  }

  /* Inspection helpers for tests. */
  hitRows(): { k: string; t: number; id: string }[] {
    return this.db.prepare('SELECT k, t, id FROM hits ORDER BY t, id').all() as {
      k: string;
      t: number;
      id: string;
    }[];
  }
  dailyRows(): { day: string; n: number; last_id: string | null }[] {
    return this.db.prepare('SELECT day, n, last_id FROM daily ORDER BY day').all() as {
      day: string;
      n: number;
      last_id: string | null;
    }[];
  }
  close(): void {
    this.db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Request and deps helpers                                            */
/* ------------------------------------------------------------------ */

export const TEST_ORIGIN = 'https://advent.test';
export const TEST_URL = `${TEST_ORIGIN}/api/parse`;
export const TEST_IP = '203.0.113.7';

export interface TestRequestOptions {
  method?: string;
  /** Object (JSON-encoded) or a raw string body. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Set false to omit the CF-Connecting-IP header. */
  ip?: string | false;
  /** Set false to omit the content type. */
  contentType?: string | false;
}

/** A valid parse request by default: POST, JSON, same origin, client IP set. */
export function makeRequest(opts: TestRequestOptions = {}): Request {
  const method = opts.method ?? 'POST';
  const headers = new Headers();
  if (opts.contentType !== false) headers.set('Content-Type', opts.contentType ?? 'application/json');
  headers.set('Origin', TEST_ORIGIN);
  headers.set('Sec-Fetch-Site', 'same-origin');
  if (opts.ip !== false) headers.set('CF-Connecting-IP', opts.ip ?? TEST_IP);
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const raw =
    opts.body === undefined
      ? JSON.stringify({ text: 'go inside', context: { room: 'pitch dark', objects: [], last: [] } })
      : typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body);
  return new Request(TEST_URL, { method, headers, ...(hasBody ? { body: raw } : {}) });
}

/** Manual timers: nothing fires until the test advances the clock. */
export class ManualClock {
  private current: number;
  private nextHandle = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private idCounter = 0;
  readonly deferred: Promise<unknown>[] = [];
  readonly logs: { status: number; code?: string; ms: number }[] = [];

  constructor(startMs = Date.UTC(2026, 0, 15, 12, 0, 0)) {
    this.current = startMs;
  }

  now = (): number => this.current;
  newId = (): string => `req-${(this.idCounter++).toString(16).padStart(8, '0')}`;
  setTimer = (fn: () => void, ms: number): unknown => {
    const h = this.nextHandle++;
    this.timers.set(h, { at: this.current + ms, fn });
    return h;
  };
  clearTimer = (h: unknown): void => {
    if (typeof h === 'number') this.timers.delete(h);
  };
  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Moves time forward and fires due timers in order. */
  advance(ms: number): void {
    this.current += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.at <= this.current)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [h, t] of due) {
      this.timers.delete(h);
      t.fn();
    }
  }
  setTime(ms: number): void {
    this.current = ms;
  }
}

export interface TestDepsOptions {
  provider?: Provider | undefined;
  store?: GateStore | undefined;
  clock?: ManualClock;
  hashIp?: ParseDeps['hashIp'];
}

/** Builds ParseDeps with injected clock, ids and timers. Pass `provider: undefined` explicitly to omit it. */
export function makeDeps(opts: TestDepsOptions = {}): { deps: ParseDeps; clock: ManualClock } {
  const clock = opts.clock ?? new ManualClock();
  const has = (k: keyof TestDepsOptions): boolean => Object.prototype.hasOwnProperty.call(opts, k);
  const deps: ParseDeps = {
    provider: has('provider') ? opts.provider : new FakeProvider(),
    store: has('store') ? opts.store : new MemoryGateStore(),
    now: clock.now,
    newId: clock.newId,
    hashIp: opts.hashIp ?? hashIpKey,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    defer: (p) => {
      clock.deferred.push(p);
    },
    log: (entry) => {
      clock.logs.push(entry);
    },
  };
  return { deps, clock };
}

/** A configured environment: model, cap, salt. Override or delete keys per test. */
export function makeEnv(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MODEL_NAME: 'test-model',
    DAILY_CAP: '1000',
    RATE_LIMIT: '30',
    RATE_WINDOW_SECONDS: '60',
    UPSTREAM_TIMEOUT_MS: '3500',
    IP_HASH_SALT: 'test-salt',
    ...over,
  };
}
