/**
 * Client AI parser constants. New code; not ported from Open Adventure.
 */

/** Total time the player waits for the AI before the classic parser is used. The single named budget. */
export const AI_BUDGET_MS = 4000;
export const ENDPOINT = '/api/parse';

/** Consecutive availability failures that open the circuit. */
export const BREAKER_THRESHOLD = 3;
export const BREAKER_OPEN_MS = 60_000;

/** Seconds to wait after a 429 when Retry-After is missing, non-numeric or under 1. */
export const RETRY_AFTER_DEFAULT_S = 30;
export const RETRY_AFTER_MAX_S = 120;

/** Response bodies longer than this are treated as malformed. */
export const MAX_RESPONSE_CHARS = 1024;
