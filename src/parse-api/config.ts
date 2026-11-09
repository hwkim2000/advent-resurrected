/**
 * Parse_Endpoint configuration read from the Function environment.
 * New code for this project; not ported from Open Adventure.
 * Every value is a plain non-secret variable. Nothing here is a credential.
 */
import { DEFAULT_RATE_LIMIT, DEFAULT_RATE_WINDOW_S, DEFAULT_UPSTREAM_MS } from '../shared/limits';

export const ENV_VARIABLE_NAMES = [
  'MODEL_NAME',
  'DAILY_CAP',
  'RATE_LIMIT',
  'RATE_WINDOW_SECONDS',
  'UPSTREAM_TIMEOUT_MS',
  'IP_HASH_SALT',
  'DEV_ALLOW_MISSING_IP',
] as const;

export interface ParseConfig {
  /** Model identifier; undefined when missing or empty (endpoint answers `unavailable`). */
  model: string | undefined;
  /** Per-UTC-day cap; undefined when absent or invalid, which is treated as "cap reached". */
  dailyCap: number | undefined;
  /** Requests allowed per window per client; default 30. */
  rateLimit: number;
  /** Window length in milliseconds; default 60 s. */
  rateWindowMs: number;
  /** Upstream (Provider) timeout in milliseconds; default 3500. */
  upstreamMs: number;
  /** Salt for the IP hash; undefined makes the gate unavailable (fail closed). */
  salt: string | undefined;
  /** True only for the literal "1" (set in .dev.vars, never in wrangler.toml). */
  allowMissingIp: boolean;
}

const CAP_PATTERN = /^[1-9][0-9]{0,8}$/;
const POSITIVE_INT = /^[1-9][0-9]{0,8}$/;

/** Accept a string or a safe integer number; anything else is "absent". */
function asText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  return undefined;
}

function positiveInt(v: unknown, fallback: number): number {
  const t = asText(v);
  return t !== undefined && POSITIVE_INT.test(t) ? Number(t) : fallback;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Read the configuration. Total: never throws, defaults for invalid values. */
export function readConfig(env: Record<string, unknown>): ParseConfig {
  const capText = asText(env['DAILY_CAP']);
  return {
    model: nonEmpty(env['MODEL_NAME']),
    dailyCap: capText !== undefined && CAP_PATTERN.test(capText) ? Number(capText) : undefined,
    rateLimit: positiveInt(env['RATE_LIMIT'], DEFAULT_RATE_LIMIT),
    rateWindowMs: positiveInt(env['RATE_WINDOW_SECONDS'], DEFAULT_RATE_WINDOW_S) * 1000,
    upstreamMs: positiveInt(env['UPSTREAM_TIMEOUT_MS'], DEFAULT_UPSTREAM_MS),
    salt: nonEmpty(env['IP_HASH_SALT']),
    allowMissingIp: env['DEV_ALLOW_MISSING_IP'] === '1',
  };
}
