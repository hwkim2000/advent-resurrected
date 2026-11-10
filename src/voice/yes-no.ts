// Yes/no mapping for spoken answers (spec: voice-input, Requirement 9.3).
// New code for this project; not ported from Open Adventure.

const YES_WORDS: ReadonlySet<string> = new Set([
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'affirmative',
]);
const NO_WORDS: ReadonlySet<string> = new Set(['no', 'nope', 'nah', 'negative']);

/**
 * Whole-string comparison of cleaned text against the yes and no word lists.
 * `yes please` is not `YES`.
 */
export function mapYesNo(cleaned: string): 'YES' | 'NO' | null {
  if (typeof cleaned !== 'string') return null;
  if (YES_WORDS.has(cleaned)) return 'YES';
  if (NO_WORDS.has(cleaned)) return 'NO';
  return null;
}
