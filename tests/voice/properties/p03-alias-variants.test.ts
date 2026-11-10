// Feature: voice-input, Property 3: Alias recognition survives its variants
// **Validates: Requirements 10.3, 10.4, 10.7, 10.12**
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LEAD_INS, MAGIC_ALIASES } from '../../../src/voice/magic-aliases'
import type { MagicCommand } from '../../../src/voice/magic-aliases'
import { matchMagicWords } from '../../../src/voice/magic-match'
import { arbAliasEntry, arbAliasVariant } from '../support/generators'
import { ORDINARY_WORDS } from '../support/ordinary-words'
import { voiceAssert } from '../support/pbt'

const arbLeadIn = fc.constantFrom(...LEAD_INS)
const arbOrdinary = fc.constantFrom(...ORDINARY_WORDS)

// Single-token aliases only (a suffix on "x y z z y" or "plug h" is not a token suffix).
const arbSingleTokenAlias = arbAliasEntry.filter(({ alias }) => !alias.includes(' '))

describe('Property 3: alias recognition survives its variants', () => {
  it('a variant gives the same commands as the plain alias, with tier alias', () => {
    voiceAssert(
      fc.property(arbAliasVariant, ({ command, text }) => {
        const m = matchMagicWords([text])
        expect(m).not.toBeNull()
        expect(m?.commands).toEqual([command])
        expect(m?.tier).toBe('alias')
        expect(m?.alternativeIndex).toBe(0)
      }),
    )
  })

  it('a variant matches exactly as the plain alias does', () => {
    voiceAssert(
      fc.property(arbAliasVariant, arbAliasEntry, (variant, entry) => {
        fc.pre(variant.command === entry.command)
        expect(matchMagicWords([variant.text])?.commands).toEqual(matchMagicWords([entry.alias])?.commands)
      }),
    )
  })

  it('<alias>s and <alias>\'s match only for aliases of five or more letters', () => {
    voiceAssert(
      fc.property(arbSingleTokenAlias, fc.constantFrom('s', "'s"), ({ command, alias }, suffix) => {
        const m = matchMagicWords([alias + suffix])
        if (alias.length >= 5) {
          expect(m?.commands).toEqual([command])
          expect(m?.tier).toBe('alias')
        } else {
          expect(m).toBeNull()
        }
      }),
    )
  })

  it('names the documented plural examples', () => {
    expect(matchMagicWords(['plovers'])?.commands).toEqual(['PLOVER'])
    expect(matchMagicWords(["plover's"])?.commands).toEqual(['PLOVER'])
    for (const t of ['plugs', "fee's", 'lovers']) expect(matchMagicWords([t])).toBeNull()
  })

  it('a lead-in alone gives no match', () => {
    voiceAssert(
      fc.property(arbLeadIn, (leadIn) => {
        expect(matchMagicWords([leadIn])).toBeNull()
      }),
    )
  })

  it('a lead-in followed by a non-alias token gives no match', () => {
    voiceAssert(
      fc.property(arbLeadIn, arbOrdinary, (leadIn, word) => {
        expect(matchMagicWords([`${leadIn} ${word}`])).toBeNull()
      }),
    )
  })

  it('any token before a lead-in gives no match', () => {
    voiceAssert(
      fc.property(
        fc.oneof(arbOrdinary, arbSingleTokenAlias.map((e) => e.alias)),
        arbLeadIn,
        arbAliasEntry,
        (before, leadIn, { alias }) => {
          expect(matchMagicWords([`${before} ${leadIn} ${alias}`])).toBeNull()
        },
      ),
    )
  })

  it('every command is reachable from its aliases', () => {
    for (const command of Object.keys(MAGIC_ALIASES) as MagicCommand[]) {
      for (const alias of MAGIC_ALIASES[command]) {
        expect(matchMagicWords([alias])?.commands).toEqual([command])
      }
    }
  })
})
