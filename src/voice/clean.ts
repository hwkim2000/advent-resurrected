/**
 * Transcript cleaning for the voice layer (Requirement 8.1).
 * New code for this project; not ported from Open Adventure.
 */
import { normalizePlayerText } from '../shared/normalize';
import { SPOKEN_TEXT_MAX_CHARS } from './config';

const APOSTROPHES = /[\u2018\u2019\u02BC]/g;
const HYPHENS = /\u2010/g;
const OUTSIDE_ALLOWED = /[^a-z0-9' -]+/g;
const SPACE_RUN = / {2,}/g;

/**
 * Clean one Spoken_Text. Total (never throws), bounded to
 * SPOKEN_TEXT_MAX_CHARS, output only contains [a-z0-9' -], and idempotent.
 * Order: coerce, normalizePlayerText, map apostrophes/hyphen, lower case,
 * replace disallowed runs with a space, collapse spaces, trim, cut, trim.
 */
export function cleanTranscript(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = normalizePlayerText(input)
    .replace(APOSTROPHES, "'")
    .replace(HYPHENS, '-')
    .toLowerCase()
    .replace(OUTSIDE_ALLOWED, ' ')
    .replace(SPACE_RUN, ' ')
    .trim();
  return s.slice(0, SPOKEN_TEXT_MAX_CHARS).trim();
}
