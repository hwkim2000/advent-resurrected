/**
 * Client AI parser: asks /api/parse to map a sentence to a classic command and
 * re-validates the answer. Every failure resolves to a fallback; translate()
 * never rejects. New code; not ported from Open Adventure.
 *
 * Uses only fetch, AbortController, Promise, timers and navigator.onLine
 * (through injected dependencies).
 */
import { validateCommand } from '../shared/command-validation';
import { decodeErrorBody, decodeSuccess, encodeRequest } from '../shared/protocol';
import {
  AI_BUDGET_MS,
  BREAKER_OPEN_MS,
  BREAKER_THRESHOLD,
  ENDPOINT,
  MAX_RESPONSE_CHARS,
  RETRY_AFTER_DEFAULT_S,
  RETRY_AFTER_MAX_S,
} from './config';
import { classifyInput } from './eligibility';
import type { ResolveInput } from './eligibility';
import { CommandMemory, buildGameContext } from './game-context';

export interface AiParserDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Monotonic milliseconds, for the breaker and the Retry-After wait. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  isOnline(): boolean;
  log: { error(message: string, cause?: unknown): void };
  /** Defaults to AI_BUDGET_MS. */
  budgetMs?: number;
}

export type TranslateOutcome =
  | { kind: 'translated'; command: string }
  | { kind: 'fallback'; notice: boolean };

/** What one request produced, before it is interpreted. */
type RawResult =
  | { t: 'response'; status: number; retryAfter: string | null; text: string }
  | { t: 'timeout' }
  | { t: 'aborted' }
  | { t: 'error'; cause: unknown };

export class AiParser {
  private readonly deps: AiParserDeps;
  private readonly memory = new CommandMemory();
  private inFlight = false;
  private failures = 0;
  private openUntil: number | undefined;
  private waitUntil: number | undefined;
  private noticeArmed = true;

  constructor(deps: AiParserDeps) {
    this.deps = deps;
  }

  /** True for the lines that take the asynchronous path (ask, or over-long/unsafe text). */
  needsTranslation(line: string, input: ResolveInput): boolean {
    try {
      return classifyInput(line, input).kind !== 'pass';
    } catch (cause) {
      this.deps.log.error('ai-parser: eligibility failed', cause);
      return false;
    }
  }

  /** Never rejects. */
  async translate(line: string, input: ResolveInput, signal: AbortSignal): Promise<TranslateOutcome> {
    try {
      return await this.run(line, input, signal);
    } catch (cause) {
      this.deps.log.error('ai-parser: unexpected failure', cause);
      this.inFlight = false;
      return { kind: 'fallback', notice: false };
    }
  }

  /** Called on every new game and restore. */
  startGame(): void {
    this.memory.reset();
  }

  /** Called with the text given to the engine. */
  accepted(text: string): void {
    try {
      this.memory.note(text);
    } catch (cause) {
      this.deps.log.error('ai-parser: memory failed', cause);
    }
  }

  // ------------------------------------------------------------------ internals

  private fallback(notice: boolean): TranslateOutcome {
    return { kind: 'fallback', notice };
  }

  /** Availability trouble: one notice until a translation succeeds again. */
  private availabilityFallback(): TranslateOutcome {
    const notice = this.noticeArmed;
    this.noticeArmed = false;
    return this.fallback(notice);
  }

  private countFailure(): void {
    this.failures += 1;
    if (this.failures >= BREAKER_THRESHOLD) {
      this.openUntil = this.deps.now() + BREAKER_OPEN_MS;
      this.failures = 0;
    }
  }

  private async run(line: string, input: ResolveInput, signal: AbortSignal): Promise<TranslateOutcome> {
    const eligibility = classifyInput(line, input);
    if (eligibility.kind !== 'ask') return this.fallback(false);
    if (signal.aborted) return this.fallback(false);
    if (this.inFlight) return this.fallback(false);

    const now = this.deps.now();
    if (!this.deps.isOnline()) return this.availabilityFallback();
    if (this.openUntil !== undefined) {
      if (now < this.openUntil) return this.availabilityFallback();
      this.openUntil = undefined;
    }
    if (this.waitUntil !== undefined) {
      if (now < this.waitUntil) return this.availabilityFallback();
      this.waitUntil = undefined;
    }

    const state = input.state;
    if (state === undefined) return this.fallback(false);
    const body = encodeRequest({
      text: eligibility.text,
      context: buildGameContext(state, this.memory.last),
    });

    const raw = await this.send(body, signal);
    return this.interpret(raw);
  }

  /** One request, bounded by the budget; settles exactly once and ignores late results. */
  private send(body: string, callerSignal: AbortSignal): Promise<RawResult> {
    const deps = this.deps;
    const budget = deps.budgetMs ?? AI_BUDGET_MS;
    this.inFlight = true;
    return new Promise<RawResult>((resolve) => {
      const controller = new AbortController();
      let settled = false;
      let timer: unknown;
      const onCallerAbort = (): void => finish({ t: 'aborted' });
      const finish = (result: RawResult): void => {
        if (settled) return;
        settled = true;
        this.inFlight = false;
        if (timer !== undefined) deps.clearTimer(timer);
        callerSignal.removeEventListener('abort', onCallerAbort);
        if (result.t !== 'response') controller.abort();
        resolve(result);
      };

      callerSignal.addEventListener('abort', onCallerAbort);
      try {
        timer = deps.setTimer(() => finish({ t: 'timeout' }), budget);
        deps
          .fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          })
          .then(async (res) => {
            const text = await res.text();
            finish({
              t: 'response',
              status: res.status,
              retryAfter: res.headers.get('retry-after'),
              text,
            });
          })
          .catch((cause: unknown) => finish({ t: 'error', cause }));
      } catch (cause) {
        finish({ t: 'error', cause });
      }
      if (callerSignal.aborted) finish({ t: 'aborted' });
    });
  }

  private interpret(raw: RawResult): TranslateOutcome {
    switch (raw.t) {
      case 'aborted':
        return this.fallback(false);
      case 'timeout':
        this.countFailure();
        return this.availabilityFallback();
      case 'error':
        this.deps.log.error('ai-parser: request failed', raw.cause);
        this.countFailure();
        return this.availabilityFallback();
      case 'response':
        return this.interpretResponse(raw.status, raw.retryAfter, raw.text);
    }
  }

  private interpretResponse(status: number, retryAfter: string | null, text: string): TranslateOutcome {
    if (status >= 500) {
      this.countFailure();
      return this.availabilityFallback();
    }
    if (status === 429) {
      this.waitUntil = this.deps.now() + parseRetryAfterSeconds(retryAfter) * 1000;
      return this.availabilityFallback();
    }
    if (text.length > MAX_RESPONSE_CHARS) return this.availabilityFallback();
    const json = parseJson(text);
    if (json === undefined) return this.availabilityFallback();

    if (status === 422) {
      if (decodeErrorBody(json) === 'no_command') return this.fallback(false);
      return this.availabilityFallback();
    }
    if (status !== 200) return this.availabilityFallback();

    const decoded = decodeSuccess(json);
    if (decoded === undefined) return this.availabilityFallback();
    const checked = validateCommand(decoded);
    if (!checked.ok) return this.availabilityFallback();

    this.failures = 0;
    this.noticeArmed = true;
    return { kind: 'translated', command: checked.command };
  }
}

/** Retry-After in whole seconds: 30 when missing, non-numeric or under 1; at most 120. */
function parseRetryAfterSeconds(header: string | null): number {
  if (header === null || !/^\s*[0-9]+\s*$/.test(header)) return RETRY_AFTER_DEFAULT_S;
  const n = Number(header.trim());
  if (!Number.isFinite(n) || n < 1) return RETRY_AFTER_DEFAULT_S;
  return Math.min(n, RETRY_AFTER_MAX_S);
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value === undefined ? undefined : value;
  } catch {
    return undefined;
  }
}
