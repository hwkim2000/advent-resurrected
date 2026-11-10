// Voice input constants (spec: voice-input, glossary "Constants").
// DEFLECTION_LIMIT is deliberately not here (DD-5): it lives in src/haunt and src/ui/autosave.

/** A mouse/pen/Alt+M press shorter than this latches instead of holding. */
export const MIN_HOLD_MS = 250;
/** A latched session ends after this long without a final result. */
export const MAX_LISTEN_MS = 10000;
/** How long to wait for a final result after stop(). */
export const RESULT_WAIT_MS = 3000;
/** Calm Voice_Status messages clear after this long. */
export const STATUS_CLEAR_MS = 4000;
/** Maximum characters of the live preview in the Voice_Status. */
export const PREVIEW_MAX_CHARS = 80;
/** Maximum alternatives requested from and accepted from the provider. */
export const MAX_ALTERNATIVES = 5;
/** The matcher looks at no more than this many alternatives. */
export const MAGIC_ALTERNATIVES_CHECKED = 3;
/** The matcher only considers the first alternative when it has at most this many tokens. */
export const MAGIC_TOP_TOKEN_LIMIT = 4;
/** Consecutive failed sessions before the Mic_Button hides. */
export const REPEATED_ERRORS_BEFORE_HIDE = 3;
/** Equal to TEXT_MAX_CHARS of src/shared/limits.ts (asserted by a test). */
export const SPOKEN_TEXT_MAX_CHARS = 200;

/** Words offered to the recognizer as contextual-biasing phrases. */
export const MAGIC_PHRASES: readonly string[] = [
  'xyzzy',
  'plugh',
  'plover',
  'fee',
  'fie',
  'foe',
  'foo',
];

/** Contextual-biasing boost, 0.0 to 10.0 (untested tuning value). */
export const PHRASE_BOOST = 3;
