// Feature: voice-input, Property 7: Ordinary words never match.
// Exhaustive over a finite set (not sampled): every Game_Vocabulary word except the
// nine Magic_Word spellings, every corpus word, every Stop_List word.
// **Validates: Requirements 10.11, 10.13, 10.14**
import { describe, expect, it } from 'vitest'
import { ACTIONS, MOTIONS, OBJECTS } from '../../../src/data/dungeon'
import { lookupWord } from '../../../src/shared/vocabulary'
import { matchMagicWords } from '../../../src/voice/magic-match'
import { isDistanceOne } from '../../../src/voice/edit-distance'
import { STOP_LIST } from '../../../src/voice/magic-aliases'
import { ORDINARY_WORDS } from '../support/ordinary-words'

/** The nine exceptions of Requirement 10.11. */
const MAGIC_SPELLINGS: ReadonlySet<string> = new Set([
  'xyzzy', 'plugh', 'plove', 'plover', 'fee', 'fie', 'foe', 'foo', 'fum',
])
const CANONICAL = ['xyzzy', 'plugh', 'plover']

function gameVocabulary(): string[] {
  const all = new Set<string>()
  for (const m of MOTIONS) for (const w of m.words) all.add(w.toLowerCase())
  for (const o of OBJECTS) for (const w of o.words) all.add(w.toLowerCase())
  for (const a of ACTIONS) for (const w of a.words) all.add(w.toLowerCase())
  return [...all]
}

describe('Property 7: ordinary words never match', () => {
  const vocab = gameVocabulary()

  it('the vocabulary set is non-empty and contains the nine exceptions', () => {
    expect(vocab.length).toBeGreaterThan(300)
    // The table stores PLOVE; `plover` resolves to it by the five-character rule.
    for (const w of MAGIC_SPELLINGS) expect(lookupWord(w), w).toBeDefined()
  })

  it('no Game_Vocabulary word other than the nine exceptions matches (bare and after a lead-in)', () => {
    let checked = 0
    for (const w of vocab) {
      if (MAGIC_SPELLINGS.has(w)) continue
      checked++
      expect(matchMagicWords([w]), w).toBeNull()
      expect(matchMagicWords([`say ${w}`]), `say ${w}`).toBeNull()
      expect(matchMagicWords([w.toUpperCase() + '.']), w).toBeNull()
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('every corpus word matches nothing', () => {
    for (const w of ORDINARY_WORDS) expect(matchMagicWords([w]), w).toBeNull()
  })

  it('every Stop_List word matches nothing', () => {
    for (const w of STOP_LIST) expect(matchMagicWords([w]), w).toBeNull()
  })

  it('every corpus word of five or more letters at distance 1 from a canonical word is in the Stop_List', () => {
    for (const w of ORDINARY_WORDS) {
      if (!/^[a-z]{5,}$/.test(w)) continue
      if (CANONICAL.some((c) => isDistanceOne(w, c))) expect(STOP_LIST, w).toContain(w)
    }
  })
})
