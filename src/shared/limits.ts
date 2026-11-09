/**
 * Shared limits for the AI parser (client and Parse_Endpoint).
 * New code for this project; not ported from Open Adventure.
 */
export const TEXT_MAX_CHARS = 200;
export const BODY_MAX_BYTES = 2048;
export const COMMAND_MAX_CHARS = 30;
export const ROOM_MAX_CHARS = 80;
export const OBJECTS_MAX = 12;
export const OBJECT_WORD_MAX = 12;
export const LAST_MAX = 2;
export const MAX_OUTPUT_TOKENS = 16;
export const DEFAULT_RATE_LIMIT = 30;
export const DEFAULT_RATE_WINDOW_S = 60;
export const DEFAULT_UPSTREAM_MS = 3500;
export const DARK_ROOM = 'pitch dark';
/** The prompt's "cannot translate" answer. Not a vocabulary word, so it never validates. */
export const NO_COMMAND_TOKEN = 'NOCOMMAND';
