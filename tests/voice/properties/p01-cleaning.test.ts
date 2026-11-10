// Feature: voice-input, Property 1: Cleaning is total, bounded, normalized and idempotent
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { TEXT_MAX_CHARS } from '../../../src/shared/limits'
import { SPOKEN_TEXT_MAX_CHARS } from '../../../src/voice/config'
import { cleanTranscript } from '../../../src/voice/clean'
import { voiceAssert } from '../support/pbt'

const loneUnit = fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c))

const arbMixedString = fc.string({
  unit: fc.oneof(
    loneUnit,
    fc.constantFrom('a', 'Z', '9', ' ', '\t', '\n', '\u00a0', "'", '-', '\u2018', '\u2019', '\u02bc', '\u2010', 'é', 'ﬁ', '\u{1F600}', '.', '!'),
    fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
  ),
  maxLength: 400,
})

const arbLongString = fc.string({ unit: 'binary', minLength: 10000, maxLength: 12000, size: 'max' })

const arbInput = fc.oneof(
  arbMixedString,
  arbLongString,
  fc.constant(''),
  fc.anything(),
  fc.constantFrom(null, undefined, 0, 1, true, {}, [], ['a']),
)

describe('Property 1: cleaning is total, bounded, normalized and idempotent', () => {
  it('SPOKEN_TEXT_MAX_CHARS equals TEXT_MAX_CHARS', () => {
    expect(SPOKEN_TEXT_MAX_CHARS).toBe(TEXT_MAX_CHARS)
  })

  it('never throws, stays within bounds and the allowed alphabet, and is idempotent', () => {
    voiceAssert(
      fc.property(arbInput, (x) => {
        const out = cleanTranscript(x)
        expect(typeof out).toBe('string')
        expect(out.length).toBeLessThanOrEqual(200)
        expect(out).toMatch(/^[a-z0-9' -]*$/)
        expect(out).not.toMatch(/ {2}/)
        expect(out).toBe(out.trim())
        expect(cleanTranscript(out)).toBe(out)
      }),
    )
  })

  it('returns the empty string for non-string input', () => {
    voiceAssert(
      fc.property(
        fc.anything().filter((v) => typeof v !== 'string'),
        (x) => cleanTranscript(x) === '',
      ),
    )
  })

  it('maps U+2018, U+2019, U+02BC to an apostrophe and U+2010 to a hyphen before filtering', () => {
    const letters = fc.stringMatching(/^[a-z]{1,8}$/)
    voiceAssert(
      fc.property(
        letters,
        letters,
        fc.constantFrom('\u2018', '\u2019', '\u02bc'),
        (a, b, q) => cleanTranscript(`${a}${q}${b}`) === `${a}'${b}`,
      ),
    )
    voiceAssert(fc.property(letters, letters, (a, b) => cleanTranscript(`${a}\u2010${b}`) === `${a}-${b}`))
  })

  it('handles 10,000+ character inputs without throwing', () => {
    voiceAssert(
      fc.property(arbLongString, (x) => {
        expect(cleanTranscript(x).length).toBeLessThanOrEqual(200)
      }),
    )
  })
})
