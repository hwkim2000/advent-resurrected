/**
 * Cloudflare Pages Function for POST /api/parse. New code for this project.
 * Thin wiring only: bindings (AI, DB), clock, ids, timers and the log function
 * are handed to the pure handler in src/parse-api. This is the only file that
 * uses Cloudflare types.
 */
import { d1GateStore, hashIpKey } from '../../src/parse-api/d1-gate-store';
import type { D1Like } from '../../src/parse-api/d1-gate-store';
import { readConfig } from '../../src/parse-api/config';
import { handleParse } from '../../src/parse-api/handler';
import type { ParseDeps } from '../../src/parse-api/handler';
import { workersAiProvider } from '../../src/parse-api/provider';
import type { AiLike } from '../../src/parse-api/provider';

interface Env {
  AI?: Ai;
  DB?: D1Database;
  MODEL_NAME?: string;
  DAILY_CAP?: string;
  RATE_LIMIT?: string;
  RATE_WINDOW_SECONDS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  IP_HASH_SALT?: string;
  DEV_ALLOW_MISSING_IP?: string;
}

export const onRequest: PagesFunction<Env> = (context) => {
  const env = context.env;
  const model = readConfig(env as unknown as Record<string, unknown>).model;
  // The real Ai type has overloads and model generics; the adapter only needs run().
  const ai = env.AI as unknown as AiLike | undefined;
  const deps: ParseDeps = {
    provider: ai && model !== undefined ? workersAiProvider(ai, model) : undefined,
    store: env.DB ? d1GateStore(env.DB as unknown as D1Like) : undefined,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    hashIp: hashIpKey,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    defer: (p) => context.waitUntil(p),
    log: (entry) => console.log(JSON.stringify(entry)),
  };
  return handleParse(context.request, env as unknown as Record<string, unknown>, deps);
};
