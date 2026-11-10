// Generators for the voice-input property tests (fast-check 4.10.2 forms from spike-results.md).
// Plain data only: nothing here imports final-result.ts, so the host snapshot is a local shape.
import fc from 'fast-check'
import { LEAD_INS, MAGIC_ALIASES, STOP_LIST } from '../../../src/voice/magic-aliases'
import { ORDINARY_WORDS } from './ordinary-words'

/** Structural copy of HostSnapshot (design.md); fields may be undefined. */
export interface HostSnapshotData {
  gameMode: '1976' | 'haunted' | undefined
  promptKind: 'command' | 'yesno' | 'filename' | undefined
  phase: 'booting' | 'ready' | 'over' | 'failed' | undefined
}

const loneUnit = fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c))

/** Arbitrary (dirty) transcript text: any code point, lone surrogates, accents, punctuation. */
export const arbDirtyTranscript: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 60 }),
  fc.string({
    unit: fc.oneof(loneUnit, fc.constantFrom('a', 'é', '\u{1F600}', ' ', '-', "'", '\u2019', '\u2010', '\u02BC', '.', ',')),
    maxLength: 40,
  }),
  fc.string({ unit: 'binary-ascii', maxLength: 60 }),
  // Long inputs (up to 10,000 UTF-16 units) so truncation is exercised.
  fc.string({ unit: 'binary-ascii', minLength: 10000, maxLength: 10000 }),
  fc.string({ unit: 'binary', maxLength: 10000, size: 'max' }),
)

const cleanedChars = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')

/** Already-cleaned looking text: [a-z0-9' -], single spaces, trimmed. */
export const arbCleanedText: fc.Arbitrary<string> = fc
  .array(
    fc.string({ unit: fc.constantFrom(...cleanedChars, "'", '-'), minLength: 1, maxLength: 8 }),
    { maxLength: 8 },
  )
  .map((words) => words.join(' '))

/** A canonical magic command plus one of its aliases. */
export const arbAliasEntry: fc.Arbitrary<{ command: keyof typeof MAGIC_ALIASES; alias: string }> = fc
  .constantFrom(...(Object.keys(MAGIC_ALIASES) as (keyof typeof MAGIC_ALIASES)[]))
  .chain((command) =>
    fc.constantFrom(...MAGIC_ALIASES[command]).map((alias) => ({ command, alias })),
  )

const arbCase = fc.constantFrom<(s: string) => string>(
  (s) => s,
  (s) => s.toUpperCase(),
  (s) => s.charAt(0).toUpperCase() + s.slice(1),
)

/** Variants of a spoken alias: case, trailing period, whitespace, at most one lead-in. */
export const arbAliasVariant: fc.Arbitrary<{ command: keyof typeof MAGIC_ALIASES; text: string }> = fc
  .tuple(
    arbAliasEntry,
    arbCase,
    fc.constantFrom('', '.', '!', ' .', '?'),
    fc.constantFrom('', ' ', '  ', '\t', '\n'),
    fc.constantFrom('', ' ', '   '),
    fc.option(fc.constantFrom(...LEAD_INS), { nil: undefined }),
  )
  .map(([{ command, alias }, caseFn, suffix, lead, trail, leadIn]) => ({
    command,
    text: `${lead}${leadIn === undefined ? '' : `${caseFn(leadIn)} `}${caseFn(alias)}${suffix}${trail}`,
  }))

const MAGIC_SEQUENCE = ['fee', 'fie', 'foe', 'foo'] as const

/** Runs of 1 to 6 sequence-ish tokens (in order, shuffled, repeated, or with a stranger). */
export const arbTokenRun: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom<string>(...MAGIC_SEQUENCE, 'fum', 'fi', 'fo', 'please', 'go'),
  { minLength: 1, maxLength: 6 },
)

/** An in-order prefix or whole of FEE FIE FOE FOO, as tokens (length 1 to 4). */
export const arbSequencePrefix: fc.Arbitrary<string[]> = fc
  .integer({ min: 1, max: 4 })
  .map((n) => MAGIC_SEQUENCE.slice(0, n) as string[])

/** One Alternative: usually a string, sometimes a non-string. */
export const arbAlternative: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: arbDirtyTranscript },
  { weight: 3, arbitrary: arbCleanedText },
  { weight: 3, arbitrary: arbAliasVariant.map((v) => v.text) },
  { weight: 2, arbitrary: fc.constantFrom(...ORDINARY_WORDS, ...STOP_LIST) },
  { weight: 1, arbitrary: fc.anything() },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(undefined, null, 0, 42, {}, [], true) },
)

/** Alternative lists of 0 to 10 elements. */
export const arbAlternatives: fc.Arbitrary<unknown[]> = fc.array(arbAlternative, { maxLength: 10 })

/** Alternative lists of strings only (1 to 5 elements, like a real result). */
export const arbStringAlternatives: fc.Arbitrary<string[]> = fc.array(
  fc.oneof(arbCleanedText, arbAliasVariant.map((v) => v.text)),
  { minLength: 1, maxLength: 5 },
)

/** Meta words from `isMetaWord` (spike-results.md note 9). */
export const META_LINE_WORDS = ['quit', 'save', 'resume', 'seed', 'waste', 'suspend', 'pause', 'restart'] as const

/** Lines whose first or second token is a Meta word, with optional filler. */
export const arbMetaLine: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom<string>(...META_LINE_WORDS),
    fc.constantFrom('', 'please', 'go', 'now'),
    fc.boolean(),
    arbCase,
  )
  .map(([word, filler, second, caseFn]) => {
    const w = caseFn(word)
    if (filler === '') return w
    return second ? `${filler} ${w}` : `${w} ${filler}`
  })

/** Host snapshots, including undefined fields. */
export const arbHostSnapshot: fc.Arbitrary<HostSnapshotData> = fc.record({
  gameMode: fc.option(fc.constantFrom<'1976' | 'haunted'>('1976', 'haunted'), { nil: undefined }),
  promptKind: fc.option(fc.constantFrom<'command' | 'yesno' | 'filename'>('command', 'yesno', 'filename'), {
    nil: undefined,
  }),
  phase: fc.option(fc.constantFrom<'booting' | 'ready' | 'over' | 'failed'>('booting', 'ready', 'over', 'failed'), {
    nil: undefined,
  }),
})

/** Host snapshots in which the decision is not silent for lack of data (haunted, ready). */
export const arbActiveHostSnapshot: fc.Arbitrary<HostSnapshotData> = fc
  .constantFrom<'command' | 'yesno' | 'filename'>('command', 'yesno', 'filename')
  .map((promptKind) => ({ gameMode: 'haunted', promptKind, phase: 'ready' }))
