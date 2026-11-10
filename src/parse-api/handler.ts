/**
 * Parse_Endpoint request handler. New code for this project (not a port of
 * Open Adventure). A pure function of Request + injected dependencies, so
 * tests drive it with fakes and the Pages Function only wires bindings.
 *
 * Privacy: only {status, code, ms} is logged for non-2xx responses. No request
 * data, client IP or provider output reaches a log, a body or a header.
 */
import type { ErrorCode } from '../shared/protocol';
import { decodeRequest, encodeSuccess } from '../shared/protocol';
import { GHOST_TOKEN, isGhostToken } from '../shared/ghost-ask';
import { validateCommand } from '../shared/command-validation';
import { BODY_MAX_BYTES } from '../shared/limits';
import { readConfig } from './config';
import { admit } from './gate';
import type { GateStore } from './gate';
import { jsonResponse, readBodyLimited } from './http';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import type { Provider } from './provider';

export interface ParseDeps {
  provider: Provider | undefined;
  store: GateStore | undefined;
  now(): number;
  newId(): string;
  hashIp(ip: string, salt: string): Promise<string>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** context.waitUntil */
  defer(p: Promise<unknown>): void;
  log(entry: { status: number; code?: ErrorCode; ms: number }): void;
}

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  method: 405,
  media_type: 415,
  too_large: 413,
  no_command: 422,
  rate_limited: 429,
  forbidden: 403,
  upstream: 502,
  timeout: 504,
  unavailable: 503,
};

/** One admitted request in this many triggers an opportunistic sweep. */
const SWEEP_EVERY = 32;
/** Client key used only when DEV_ALLOW_MISSING_IP is set and no IP header exists. */
const DEV_IP = 'dev-no-ip';

const TIMED_OUT = Symbol('timed out');

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value.trim());
}

function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let own: string;
    try {
      own = new URL(request.url).origin;
    } catch {
      return true;
    }
    if (origin !== own) return true;
  }
  return request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site';
}

/** Never throws; a failing defer must not change the response. */
function safeDefer(deps: ParseDeps, p: Promise<unknown>): void {
  const guarded = p.catch(() => undefined);
  try {
    deps.defer(guarded);
  } catch {
    /* ignore */
  }
}

function successResponse(command: string): Response {
  return new Response(encodeSuccess(command), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleParse(
  request: Request,
  env: Record<string, unknown>,
  deps: ParseDeps,
): Promise<Response> {
  const start = deps.now();

  const fail = (code: ErrorCode, extra?: Record<string, string>): Response => {
    const status = STATUS[code];
    try {
      deps.log({ status, code, ms: Math.max(0, deps.now() - start) });
    } catch {
      /* logging must never change the response */
    }
    return jsonResponse(status, { error: code }, extra);
  };

  try {
    // 1. Method (OPTIONS included).
    if (request.method !== 'POST') return fail('method', { Allow: 'POST' });

    // 2. Cross-site requests.
    if (isCrossOrigin(request)) return fail('forbidden');

    // 3. Content type.
    if (!isJsonContentType(request.headers.get('content-type'))) return fail('media_type');

    // 4. Size (early reject, then counted read).
    const body = await readBodyLimited(request, BODY_MAX_BYTES);
    if (!body.ok) return fail(body.reason === 'too_large' ? 'too_large' : 'bad_request');

    // 5. Availability: before the gate, so an unconfigured deployment spends no slot.
    const cfg = readConfig(env);
    const provider = deps.provider;
    const store = deps.store;
    if (!provider || !store || cfg.model === undefined || cfg.salt === undefined) {
      return fail('unavailable');
    }

    // 6. Client IP (or the dev flag).
    const cfIp = request.headers.get('cf-connecting-ip')?.trim();
    const ip = cfIp ? cfIp : cfg.allowMissingIp ? DEV_IP : undefined;
    if (ip === undefined) return fail('bad_request');

    // 7. Gate: IP window + daily slot, atomic.
    const id = deps.newId();
    const nowMs = deps.now();
    let ipKey: string;
    try {
      ipKey = await deps.hashIp(ip, cfg.salt);
    } catch {
      return fail('unavailable');
    }
    const decision = await admit(store, { ipKey, id, nowMs, cfg });
    if (decision.kind === 'rate_limited') {
      return fail('rate_limited', { 'Retry-After': String(decision.retryAfterSec) });
    }
    if (decision.kind === 'capped' || decision.kind === 'unavailable') return fail('unavailable');

    const day = decision.day;
    if ((id.charCodeAt(id.length - 1) & (SWEEP_EVERY - 1)) === 0) {
      safeDefer(deps, store.sweep(nowMs, cfg.rateWindowMs, day));
    }

    // 8. JSON and strict schema; release the slot when the request never reaches the provider.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      parsed = undefined;
    }
    const req = parsed === undefined ? undefined : decodeRequest(parsed);
    if (!req) {
      safeDefer(deps, store.releaseSlot(day));
      return fail('bad_request');
    }

    // 9. Provider, raced against the timer. A late result or rejection is ignored.
    const controller = new AbortController();
    let timerHandle: unknown;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timerHandle = deps.setTimer(() => resolve(TIMED_OUT), cfg.upstreamMs);
    });
    const call = (async (): Promise<unknown> =>
      provider.translate({
        system: buildSystemPrompt(),
        user: buildUserMessage(req.text, req.context),
        signal: controller.signal,
      }))();
    // Swallow a rejection that arrives after the race was lost.
    call.catch(() => undefined);

    let raw: unknown;
    try {
      const winner = await Promise.race([call, timeout]);
      if (winner === TIMED_OUT) {
        try {
          controller.abort();
        } catch {
          /* ignore */
        }
        return fail('timeout');
      }
      raw = winner;
    } catch {
      return fail('upstream');
    } finally {
      deps.clearTimer(timerHandle);
    }

    if (typeof raw !== 'string') return fail('upstream');

    // 10a. Reserved sentinel: the whole output, trimmed and upper-cased, is GHOST.
    if (isGhostToken(raw)) return successResponse(GHOST_TOKEN);

    // 10. Validate the candidate.
    const result = validateCommand(raw);
    if (!result.ok) return fail('no_command');

    return successResponse(result.command);
  } catch {
    return fail('upstream');
  }
}
