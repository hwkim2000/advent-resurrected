// Test doubles for the client side of the AI parser (no network, no real timers required).
// FakeFetch: scripted fetch. FakeResolver: scheduler-controlled InputResolver.

import fc from 'fast-check';
import type {
  InputResolver,
  ResolveContext,
  TranslateOutcome,
} from '../../src/ui/input-resolver';

// ---------------------------------------------------------------- FakeFetch

export type FetchBehavior =
  | { kind: 'respond'; status: number; body: string; delayMs?: number; headers?: Record<string, string> }
  | { kind: 'throw'; error?: unknown; delayMs?: number }
  | { kind: 'hang' };

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  /** Parsed JSON body when the body was a JSON string, else undefined. */
  json: unknown;
  /** True once the call's signal fired abort. */
  aborted: boolean;
}

function abortError(): Error {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

/**
 * Scripted fetch. Behaviors are consumed in order; the last one repeats.
 * Delays use the global `setTimeout`, so vitest fake timers control them.
 */
export class FakeFetch {
  readonly calls: FetchCall[] = [];
  private script: FetchBehavior[];

  constructor(script: FetchBehavior[] = [{ kind: 'respond', status: 200, body: '{"command":"LOOK"}' }]) {
    this.script = script.length > 0 ? [...script] : [{ kind: 'hang' }];
  }

  /** Replace the script (also resets the position, not the call record). */
  setScript(script: FetchBehavior[]): void {
    this.script = script.length > 0 ? [...script] : [{ kind: 'hang' }];
  }

  /** Bound function suitable for injection as `fetch`. */
  readonly fetch = (input: unknown, init?: RequestInit): Promise<Response> => {
    const behavior = this.script.length > 1 ? this.script.shift()! : this.script[0]!;
    let json: unknown;
    if (typeof init?.body === 'string') {
      try {
        json = JSON.parse(init.body);
      } catch {
        json = undefined;
      }
    }
    const call: FetchCall = { url: String(input), init, json, aborted: false };
    this.calls.push(call);

    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => {
        call.aborted = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(abortError());
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (fn: () => void): void => {
        signal?.removeEventListener('abort', onAbort);
        fn();
      };

      if (behavior.kind === 'hang') return;
      const run = (): void => {
        if (behavior.kind === 'throw') {
          settle(() => reject(behavior.error ?? new TypeError('Failed to fetch')));
        } else {
          settle(() =>
            resolve(
              new Response(behavior.body, {
                status: behavior.status,
                headers: { 'Content-Type': 'application/json', ...(behavior.headers ?? {}) },
              }),
            ),
          );
        }
      };
      const delay = behavior.delayMs ?? 0;
      if (delay > 0) timer = setTimeout(run, delay);
      else run();
    });
  };

  get callCount(): number {
    return this.calls.length;
  }
}

// -------------------------------------------------------------- FakeResolver

interface PendingTranslation {
  line: string;
  ctx: ResolveContext;
  signal: AbortSignal;
  resolve: (outcome: TranslateOutcome) => void;
}

/**
 * InputResolver whose translations stay pending until the test settles them,
 * so tests control exactly when (and in what order) results arrive.
 */
export class FakeResolver implements InputResolver {
  /** Lines for which needsTranslation returns true. Default predicate: anything with a space-free letter run > 2 words. */
  needs: (line: string, ctx: ResolveContext) => boolean;
  readonly pending: PendingTranslation[] = [];
  readonly needsCalls: string[] = [];
  readonly translateCalls: string[] = [];
  startGameCount = 0;
  readonly acceptedTexts: string[] = [];

  constructor(needs?: (line: string, ctx: ResolveContext) => boolean) {
    this.needs = needs ?? ((line) => line.trim().split(/\s+/).length > 2);
  }

  needsTranslation(line: string, ctx: ResolveContext): boolean {
    this.needsCalls.push(line);
    return this.needs(line, ctx);
  }

  translate(line: string, ctx: ResolveContext, signal: AbortSignal): Promise<TranslateOutcome> {
    this.translateCalls.push(line);
    return new Promise<TranslateOutcome>((resolve) => {
      const entry: PendingTranslation = { line, ctx, signal, resolve };
      this.pending.push(entry);
      // Never rejects: an abort settles as a silent fallback unless the test settled it first.
      signal.addEventListener(
        'abort',
        () => {
          const i = this.pending.indexOf(entry);
          if (i >= 0) {
            this.pending.splice(i, 1);
            resolve({ kind: 'fallback', notice: false });
          }
        },
        { once: true },
      );
    });
  }

  startGame(): void {
    this.startGameCount += 1;
  }

  accepted(text: string): void {
    this.acceptedTexts.push(text);
  }

  /** Settle the pending translation at `index` (default: oldest). Returns false if none. */
  settle(outcome: TranslateOutcome, index = 0): boolean {
    const entry = this.pending[index];
    if (!entry) return false;
    this.pending.splice(index, 1);
    entry.resolve(outcome);
    return true;
  }

  translated(command: string, index = 0): boolean {
    return this.settle({ kind: 'translated', command }, index);
  }

  fallback(notice = false, index = 0): boolean {
    return this.settle({ kind: 'fallback', notice }, index);
  }
}

// ----------------------------------------------------------------- Arbitraries

/** Fetch behaviors: success bodies, error statuses, malformed bodies, throws, hangs. */
export const arbFetchBehavior: fc.Arbitrary<FetchBehavior> = fc.oneof(
  fc.record({
    kind: fc.constant('respond' as const),
    status: fc.constant(200),
    body: fc.constantFrom('{"command":"LOOK"}', '{"command":"ENTER BUILD"}', '{"command":"GO"}'),
    delayMs: fc.integer({ min: 0, max: 5000 }),
  }),
  fc.record({
    kind: fc.constant('respond' as const),
    status: fc.constantFrom(400, 403, 413, 415, 422, 429, 500, 502, 503, 504),
    body: fc.oneof(
      fc.constant('{"error":"no_command"}'),
      fc.constant('{"error":"rate_limited"}'),
      fc.string({ maxLength: 40 }),
    ),
    delayMs: fc.integer({ min: 0, max: 5000 }),
    headers: fc.oneof(
      fc.constant({} as Record<string, string>),
      fc.integer({ min: 0, max: 120 }).map((n) => ({ 'Retry-After': String(n) })),
    ),
  }),
  fc.record({
    kind: fc.constant('respond' as const),
    status: fc.constant(200),
    body: fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.constant('{"command":42}'),
      fc.constant('{"command":"LOOK","extra":1}'),
      fc.constant('{"command":"QUIT"}'),
      fc.string({ minLength: 1100, maxLength: 1200 }),
    ),
    delayMs: fc.integer({ min: 0, max: 5000 }),
  }),
  fc.record({
    kind: fc.constant('throw' as const),
    delayMs: fc.integer({ min: 0, max: 5000 }),
  }),
  fc.constant({ kind: 'hang' as const }),
);

export const arbFetchScript: fc.Arbitrary<FetchBehavior[]> = fc.array(arbFetchBehavior, {
  minLength: 1,
  maxLength: 5,
});

/** Outcomes a resolver may settle with. */
export const arbTranslateOutcome: fc.Arbitrary<TranslateOutcome> = fc.oneof(
  fc.constantFrom('LOOK', 'ENTER BUILD', 'GO', 'TAKE LAMP').map((command) => ({ kind: 'translated' as const, command })),
  fc.boolean().map((notice) => ({ kind: 'fallback' as const, notice })),
);
