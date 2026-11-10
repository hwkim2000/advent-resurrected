// Deterministic magic-word matcher for voice transcripts (spec: voice-input,
// Requirements 10 and 11). New code for this project; not ported from Open Adventure.
// Pure: no clock, randomness or I/O. Never throws.
import { cleanTranscript } from './clean';
import { MAGIC_ALTERNATIVES_CHECKED, MAGIC_TOP_TOKEN_LIMIT } from './config';
import { isDistanceOne } from './edit-distance';
import { LEAD_INS, MAGIC_ALIASES, STOP_LIST } from './magic-aliases';
import type { MagicCommand } from './magic-aliases';

export type { MagicCommand } from './magic-aliases';

/** Result of the matcher: 1 to 4 canonical commands, the Alternative index and the tier. */
export interface MagicMatch {
  readonly commands: readonly MagicCommand[];
  readonly alternativeIndex: number;
  readonly tier: 'alias' | 'edit';
}

const SINGLE_LETTER = /^[a-z]$/;
const EDIT_TOKEN = /^[a-z]{5,}$/;
const EDIT_TARGETS: readonly string[] = ['xyzzy', 'plugh', 'plover'];
const SEQUENCE: readonly MagicCommand[] = ['FEE', 'FIE', 'FOE', 'FOO'];

/**
 * Split cleaned text on spaces and hyphens, then join every run of two or more
 * single-letter tokens into one token (Requirement 10.18).
 */
export function tokenize(cleaned: string): string[] {
  const raw = cleaned.split(/[ -]+/).filter((t) => t.length > 0);
  const out: string[] = [];
  let run = '';
  let runLen = 0;
  const flush = (): void => {
    if (runLen > 0) out.push(run);
    run = '';
    runLen = 0;
  };
  for (const t of raw) {
    if (SINGLE_LETTER.test(t)) {
      run += t;
      runLen++;
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out;
}

const LEAD_IN_TOKENS: readonly (readonly string[])[] = LEAD_INS.map((l) =>
  l.split(' '),
).sort((a, b) => b.length - a.length);

/** Remove at most one lead-in (longest first). */
export function stripLeadIn(tokens: readonly string[]): string[] {
  for (const lead of LEAD_IN_TOKENS) {
    if (
      tokens.length >= lead.length &&
      lead.every((w, i) => tokens[i] === w)
    ) {
      return tokens.slice(lead.length);
    }
  }
  return tokens.slice();
}

// Alias index: every alias run through the tokenizer (so "x y z z y" -> "xyzzy").
const ALIAS_INDEX: ReadonlyMap<string, MagicCommand> = (() => {
  const m = new Map<string, MagicCommand>();
  for (const cmd of Object.keys(MAGIC_ALIASES) as MagicCommand[]) {
    for (const alias of MAGIC_ALIASES[cmd]) {
      m.set(tokenize(alias).join(' '), cmd);
    }
  }
  return m;
})();

const STOP_SET: ReadonlySet<string> = new Set(STOP_LIST);

function sequenceMatches(token: string, word: MagicCommand): boolean {
  return ALIAS_INDEX.get(token) === word;
}

function matchOne(tokens: readonly string[]): MagicMatch | null {
  const n = tokens.length;
  if (n === 0 || n > MAGIC_TOP_TOKEN_LIMIT) return null;

  const whole = ALIAS_INDEX.get(tokens.join(' '));
  if (whole !== undefined) return { commands: [whole], alternativeIndex: 0, tier: 'alias' };

  if (n === 1) {
    const token = tokens[0] as string;
    // Strip one trailing 's or s; accept only aliases of five or more letters.
    let stem: string | null = null;
    if (token.endsWith("'s")) stem = token.slice(0, -2);
    else if (token.endsWith('s')) stem = token.slice(0, -1);
    if (stem !== null && stem.length >= 5) {
      const cmd = ALIAS_INDEX.get(stem);
      if (cmd !== undefined) return { commands: [cmd], alternativeIndex: 0, tier: 'alias' };
    }
    if (EDIT_TOKEN.test(token) && !STOP_SET.has(token)) {
      for (const canon of EDIT_TARGETS) {
        if (isDistanceOne(token, canon)) {
          const cmd = ALIAS_INDEX.get(canon);
          if (cmd !== undefined) return { commands: [cmd], alternativeIndex: 0, tier: 'edit' };
        }
      }
    }
    return null;
  }

  // Run of 2 to 4 tokens: the FEE FIE FOE FOO sequence, whole or as a prefix.
  for (let k = 0; k < n; k++) {
    const word = SEQUENCE[k];
    if (word === undefined || !sequenceMatches(tokens[k] as string, word)) return null;
  }
  return { commands: SEQUENCE.slice(0, n), alternativeIndex: 0, tier: 'alias' };
}

function tokensOf(alternative: unknown): string[] {
  return stripLeadIn(tokenize(cleanTranscript(alternative)));
}

/**
 * Match a final result's Alternatives against the Magic_Words. First match wins
 * within the first MAGIC_ALTERNATIVES_CHECKED Alternatives; the first Alternative
 * must have at most MAGIC_TOP_TOKEN_LIMIT tokens after lead-in removal.
 */
export function matchMagicWords(alternatives: readonly unknown[]): MagicMatch | null {
  try {
    if (!Array.isArray(alternatives) || alternatives.length === 0) return null;
    const first = tokensOf(alternatives[0]);
    if (first.length > MAGIC_TOP_TOKEN_LIMIT) return null;
    const limit = Math.min(alternatives.length, MAGIC_ALTERNATIVES_CHECKED);
    for (let i = 0; i < limit; i++) {
      const found = matchOne(i === 0 ? first : tokensOf(alternatives[i]));
      if (found !== null) return { ...found, alternativeIndex: i };
    }
    return null;
  } catch {
    return null;
  }
}
