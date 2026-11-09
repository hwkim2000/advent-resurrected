/**
 * Wire format of POST /api/parse, shared by the client and the Parse_Endpoint.
 * New code; not ported from Open Adventure. All decoders are total (never throw).
 */
import { validateContext, type GameContext } from './context-rules';
import { TEXT_MAX_CHARS } from './limits';
import { hasControlChars, hasLoneSurrogate } from './normalize';

export const ERROR_CODES = [
  'bad_request',
  'method',
  'media_type',
  'too_large',
  'no_command',
  'rate_limited',
  'forbidden',
  'upstream',
  'timeout',
  'unavailable',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ParseRequest {
  text: string;
  context: GameContext;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(x: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(x).sort();
  return keys.length === expected.length && keys.every((k, i) => k === expected[i]);
}

/** JSON request body with a fixed key order. */
export function encodeRequest(r: ParseRequest): string {
  return JSON.stringify({
    text: r.text,
    context: { room: r.context.room, objects: r.context.objects, last: r.context.last },
  });
}

/** Strict decode of a parsed JSON body; undefined when it is not a valid request. */
export function decodeRequest(body: unknown): ParseRequest | undefined {
  try {
    if (!isPlainObject(body) || !hasExactKeys(body, ['context', 'text'])) return undefined;
    const { text, context } = body;
    if (typeof text !== 'string' || text.length === 0) return undefined;
    // Length is counted in characters (code points), not UTF-16 units.
    if (text.length > TEXT_MAX_CHARS * 2 || [...text].length > TEXT_MAX_CHARS) return undefined;
    if (hasControlChars(text) || hasLoneSurrogate(text)) return undefined;
    if (!validateContext(context)) return undefined;
    return { text, context };
  } catch {
    return undefined;
  }
}

/** Success body: {"command": "..."}. */
export function encodeSuccess(command: string): string {
  return JSON.stringify({ command });
}

/** Exactly one key, `command`, holding a string. */
export function decodeSuccess(body: unknown): string | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ['command'])) return undefined;
  const { command } = body;
  return typeof command === 'string' ? command : undefined;
}

/** Error body: {"error": code} with a known code. */
export function decodeErrorBody(body: unknown): ErrorCode | undefined {
  if (!isPlainObject(body) || !hasExactKeys(body, ['error'])) return undefined;
  const { error } = body;
  return typeof error === 'string' && (ERROR_CODES as readonly string[]).includes(error)
    ? (error as ErrorCode)
    : undefined;
}
