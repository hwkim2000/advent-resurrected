/**
 * Player-text normalization shared by the AI client and the Parse_Endpoint.
 * New code for this project; not ported from Open Adventure.
 */

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;
// \s covers U+00A0 and other Unicode spaces; U+00A0 is spelled out for clarity.
const WHITESPACE_RUN = /[\s\u00A0]+/g;

/**
 * NFKC, typographic apostrophes and quotation marks to ASCII, collapse
 * whitespace runs (including U+00A0) to one space, trim. In that order.
 */
export function normalizePlayerText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** True if the string contains U+0000 to U+001F or U+007F. */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** True if the string contains an unpaired UTF-16 surrogate. Loop, no lookbehind. */
export function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
