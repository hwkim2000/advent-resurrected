// Feature: voice-input, Property 4: The Magic_Sequence is accepted exactly in order, as a whole or as a prefix
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LEAD_INS, MAGIC_ALIASES } from '../../../src/voice/magic-aliases'
import type { MagicCommand } from '../../../src/voice/magic-aliases'
import { matchMagicWords } from '../../../src/voice/magic-match'
import { voiceAssert } from '../support/pbt'

const SEQUENCE: readonly MagicCommand[] = ['FEE', 'FIE', 'FOE', 'FOO']

// Single-token aliases only (multi-token spellings such as "x y z z y" are tokenizer cases).
const SINGLE_TOKEN_ALIASES: { alias: string; command: MagicCommand }[] = (
  Object.keys(MAGIC_ALIASES) as MagicCommand[]
).flatMap((command) =>
  MAGIC_ALIASES[command].filter((a) => !a.includes(' ')).map((alias) => ({ alias, command })),
)

const arbAnyAlias = fc.constantFrom(...SINGLE_TOKEN_ALIASES)
const arbLeadIn = fc.option(fc.constantFrom(...LEAD_INS), { nil: undefined })
const arbSeparator = fc.constantFrom(' ', '-', '  ', ' - ')
const arbSuffix = fc.constantFrom('', '.', '!')

function aliasesOf(command: MagicCommand): string[] {
  return MAGIC_ALIASES[command].filter((a) => !a.includes(' '))
}

/** One alias per sequence word, for the first `length` words. */
const arbSequenceRun = (length: number): fc.Arbitrary<string[]> =>
  fc.tuple(...SEQUENCE.slice(0, length).map((c) => fc.constantFrom(...aliasesOf(c)))) as fc.Arbitrary<string[]>

function render(tokens: string[], sep: string, leadIn: string | undefined, suffix: string): string {
  return `${leadIn === undefined ? '' : `${leadIn} `}${tokens.join(sep)}${suffix}`
}

describe('Property 4: Magic_Sequence order', () => {
  it('accepts the whole sequence and each prefix of 2 or 3 words, in order', () => {
    voiceAssert(
      fc.property(
        fc.integer({ min: 2, max: 4 }).chain((n) => fc.tuple(fc.constant(n), arbSequenceRun(n))),
        arbSeparator,
        arbLeadIn,
        arbSuffix,
        ([n, tokens], sep, leadIn, suffix) => {
          const match = matchMagicWords([render(tokens, sep, leadIn, suffix)])
          expect(match).not.toBeNull()
          expect(match?.commands).toEqual(SEQUENCE.slice(0, n))
          expect(match?.tier).toBe('alias')
          expect(match?.alternativeIndex).toBe(0)
        },
      ),
    )
  })

  it('returns null for any other run of two or more alias tokens', () => {
    voiceAssert(
      fc.property(
        fc.array(arbAnyAlias, { minLength: 2, maxLength: 6 }),
        arbSeparator,
        arbLeadIn,
        arbSuffix,
        (entries, sep, leadIn, suffix) => {
          const commands = entries.map((e) => e.command)
          const isSequencePrefix =
            commands.length <= 4 && commands.every((c, i) => c === SEQUENCE[i])
          fc.pre(!isSequencePrefix)
          expect(matchMagicWords([render(entries.map((e) => e.alias), sep, leadIn, suffix)])).toBeNull()
        },
      ),
    )
  })

  it('returns null for runs of five or more tokens even when they start in order', () => {
    voiceAssert(
      fc.property(
        arbSequenceRun(4),
        arbAnyAlias,
        arbSeparator,
        arbLeadIn,
        (tokens, extra, sep, leadIn) => {
          expect(matchMagicWords([render([...tokens, extra.alias], sep, leadIn, '')])).toBeNull()
        },
      ),
    )
  })

  it('treats single letters as one token and counts the limit after the lead-in', () => {
    expect(matchMagicWords(['say the magic word fee fie foe foo'])?.commands).toEqual(SEQUENCE)
    expect(matchMagicWords(['fee-fi-fo-fum'])?.commands).toEqual(SEQUENCE)
    expect(matchMagicWords(['fee fi fo fum'])?.commands).toEqual(SEQUENCE)
    expect(matchMagicWords(['x y z z y'])?.commands).toEqual(['XYZZY'])
    expect(matchMagicWords(['x y z z y xyzzy'])).toBeNull()
  })

  it('rejects the named negative examples', () => {
    for (const text of ['xyzzy xyzzy', 'xyzzy plugh', 'fee fee fie', 'fi fie', 'fee foe', 'fie foe foo', 'foo foe fie fee', 'fee fie plugh foo']) {
      expect(matchMagicWords([text]), text).toBeNull()
    }
  })
})
