// Feature: voice-input, task 3.9: alias table example tests.
// Requirements 10.3, 10.11, 10.17.
import { describe, expect, it } from 'vitest'
import { ACTIONS, MOTIONS, OBJECTS } from '../../src/data/dungeon'
import { lookupWord } from '../../src/shared/vocabulary'
import { MAGIC_ALIASES } from '../../src/voice/magic-aliases'
import type { MagicCommand } from '../../src/voice/magic-aliases'
import { matchMagicWords } from '../../src/voice/magic-match'

const REQUIRED: Readonly<Record<MagicCommand, readonly string[]>> = {
  XYZZY: ['xyzzy', 'zizzy', 'sizzy', 'x y z z y'],
  PLUGH: ['plugh', 'plug', 'plu', 'plug h'],
  PLOVER: ['plover', 'plovers', "plover's", 'plove'],
  FEE: ['fee'],
  FIE: ['fie', 'fi'],
  FOE: ['foe', 'fo'],
  FOO: ['foo', 'fum'],
}

/** The spellings of the Magic_Words themselves (Requirement 10.11). */
const EXCEPTIONS = new Set(['xyzzy', 'plugh', 'plove', 'plover', 'fee', 'fie', 'foe', 'foo', 'fum'])

/** Table spellings of the Magic_Words in the engine vocabulary. */
const MAGIC_CANONICAL = new Set(['XYZZY', 'PLUGH', 'PLOVE', 'FEE', 'FIE', 'FOE', 'FOO', 'FUM'])

describe('Magic_Alias_Table (Requirement 10.3)', () => {
  for (const cmd of Object.keys(REQUIRED) as MagicCommand[]) {
    it(`contains the required ${cmd} aliases`, () => {
      for (const alias of REQUIRED[cmd]) {
        expect(MAGIC_ALIASES[cmd]).toContain(alias)
      }
    })
  }

  it('has at least four aliases for each of XYZZY, PLUGH and PLOVER', () => {
    expect(MAGIC_ALIASES.XYZZY.length).toBeGreaterThanOrEqual(4)
    expect(MAGIC_ALIASES.PLUGH.length).toBeGreaterThanOrEqual(4)
    expect(MAGIC_ALIASES.PLOVER.length).toBeGreaterThanOrEqual(4)
  })

  it('maps every alias to its own canonical command through the matcher', () => {
    for (const cmd of Object.keys(MAGIC_ALIASES) as MagicCommand[]) {
      for (const alias of MAGIC_ALIASES[cmd]) {
        const m = matchMagicWords([alias])
        expect(m, alias).not.toBeNull()
        expect(m?.commands, alias).toEqual([cmd])
        expect(m?.tier, alias).toBe('alias')
      }
    }
  })

  it('has no alias that is claimed by two commands', () => {
    const seen = new Map<string, string>()
    for (const cmd of Object.keys(MAGIC_ALIASES) as MagicCommand[]) {
      for (const alias of MAGIC_ALIASES[cmd]) {
        expect(seen.has(alias), alias).toBe(false)
        seen.set(alias, cmd)
      }
    }
  })
})

describe('aliases versus Game_Vocabulary (Requirement 10.11)', () => {
  it('no alias is a vocabulary word except the nine Magic_Word spellings', () => {
    for (const cmd of Object.keys(MAGIC_ALIASES) as MagicCommand[]) {
      for (const alias of MAGIC_ALIASES[cmd]) {
        if (EXCEPTIONS.has(alias)) continue
        // The engine matches on the first five letters, so plovers and plover's
        // resolve to PLOVE; that is the Magic_Word itself, not another word.
        const ok = (w: string): boolean => {
          const hit = lookupWord(w)
          return hit === undefined || MAGIC_CANONICAL.has(hit.canonical)
        }
        expect(ok(alias), alias).toBe(true)
        expect(ok(alias.replace(/ /g, '')), alias).toBe(true)
        for (const part of alias.split(' ')) {
          if (part.length > 1) expect(ok(part), part).toBe(true)
        }
      }
    }
  })

  it('no vocabulary word of src/data is an alias, except the nine spellings', () => {
    const aliases = new Set<string>()
    for (const list of Object.values(MAGIC_ALIASES)) for (const a of list) aliases.add(a)
    for (const t of [MOTIONS, OBJECTS, ACTIONS]) {
      for (const e of t) {
        for (const w of e.words ?? []) {
          const lw = w.toLowerCase()
          if (aliases.has(lw)) expect(EXCEPTIONS.has(lw), lw).toBe(true)
        }
      }
    }
  })
})

describe('multi-word and mixed utterances (Requirement 10.17)', () => {
  it.each(['xyzzy xyzzy', 'xyzzy plugh', 'go xyzzy', 'zizzy please'])('%s gives no match', (text) => {
    expect(matchMagicWords([text])).toBeNull()
  })
})
