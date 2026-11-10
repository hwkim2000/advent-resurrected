/**
 * The single source of the Voice_Disclosure text (voice-input spec, Requirement 14.4).
 * `index.html` carries the same static text; tests and `scripts/check-dist.ts`
 * compare against this constant. No other module defines this text.
 */
export const VOICE_DISCLOSURE_TEXT =
  "Speech is processed by your browser's speech service (from the maker of your browser). This game stores no audio.";
