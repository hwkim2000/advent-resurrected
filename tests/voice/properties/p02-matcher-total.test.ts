// Feature: voice-input, Property 2: The matcher is total and deterministic
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { matchMagicWords } from '../../../src/voice/magic-match'
import { arbAlternatives } from '../support/generators'
import { voiceAssert } from '../support/pbt'

const VALID_COMMANDS = ['XYZZY', 'PLUGH', 'PLOVER', 'FEE', 'FIE', 'FOE', 'FOO']

describe('Property 2: matcher totality and determinism', () => {
  it('never throws, returns null or a well-formed match, and is deterministic', () => {
    // **Validates: Requirements 10.1, 10.2**
    voiceAssert(
      fc.property(arbAlternatives, (alts) => {
        const snapshot = JSON.stringify(alts)
        const first = matchMagicWords(alts)
        const second = matchMagicWords(alts)
        expect(second).toEqual(first)
        // Input is not mutated (JSON-stable inputs only).
        if (snapshot !== undefined) expect(JSON.stringify(alts)).toBe(snapshot)
        if (first !== null) {
          expect(first.commands.length).toBeGreaterThanOrEqual(1)
          expect(first.commands.length).toBeLessThanOrEqual(4)
          for (const c of first.commands) expect(VALID_COMMANDS).toContain(c)
          expect(Number.isInteger(first.alternativeIndex)).toBe(true)
          expect(first.alternativeIndex).toBeGreaterThanOrEqual(0)
          expect(first.alternativeIndex).toBeLessThan(Math.min(3, alts.length))
          expect(['alias', 'edit']).toContain(first.tier)
        }
      }),
    )
  })

  it('gives no match for an empty array', () => {
    expect(matchMagicWords([])).toBeNull()
  })
})
