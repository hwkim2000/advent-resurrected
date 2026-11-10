// Feature: voice-input, task 3.9: Stop_List and corpus example tests.
// Requirements 10.3, 10.11, 10.14.
import { describe, expect, it } from 'vitest'
import { isDistanceOne } from '../../src/voice/edit-distance'
import { MAGIC_ALIASES, STOP_LIST } from '../../src/voice/magic-aliases'
import { matchMagicWords } from '../../src/voice/magic-match'
import { ORDINARY_WORDS } from './support/ordinary-words'

const CANONICAL = ['xyzzy', 'plugh', 'plover']

const REQUIRED_STOP = ['plush', 'fizzy', 'dizzy', 'fuzzy', 'clover', 'lover', 'plugs']
const REQUIRED_CORPUS = [
  'plush', 'plum', 'plus', 'plug in', 'plough', 'flush', 'fizzy', 'dizzy', 'fuzzy',
  'clover', 'lover', 'lovers', 'free', 'feet', "fee's", 'few', 'fly', 'fool', 'food',
  'for', 'four', 'fun', 'fur',
]

describe('Stop_List', () => {
  it('has at least 30 distinct words', () => {
    expect(STOP_LIST.length).toBeGreaterThanOrEqual(30)
    expect(new Set(STOP_LIST).size).toBe(STOP_LIST.length)
  })

  it('contains the words named in the glossary', () => {
    for (const w of REQUIRED_STOP) expect(STOP_LIST).toContain(w)
  })

  it('contains no alias', () => {
    const aliases = new Set<string>()
    for (const list of Object.values(MAGIC_ALIASES)) for (const a of list) aliases.add(a)
    for (const w of STOP_LIST) expect(aliases.has(w), w).toBe(false)
  })

  it('never matches, alone', () => {
    for (const w of STOP_LIST) expect(matchMagicWords([w]), w).toBeNull()
  })
})

describe('ordinary-word corpus (Requirement 10.14)', () => {
  it('has at least 200 distinct words', () => {
    expect(new Set(ORDINARY_WORDS).size).toBeGreaterThanOrEqual(200)
  })

  it('includes the words named in Requirement 10.14 and every Stop_List word', () => {
    for (const w of REQUIRED_CORPUS) expect(ORDINARY_WORDS).toContain(w)
    for (const w of STOP_LIST) expect(ORDINARY_WORDS).toContain(w)
  })

  it('every corpus word of five or more letters at distance 1 from a canonical word is in the Stop_List', () => {
    for (const w of ORDINARY_WORDS) {
      if (!/^[a-z]{5,}$/.test(w)) continue
      if (CANONICAL.some((c) => isDistanceOne(w, c))) {
        expect(STOP_LIST, w).toContain(w)
      }
    }
  })

  it('no corpus word matches', () => {
    for (const w of ORDINARY_WORDS) expect(matchMagicWords([w]), w).toBeNull()
  })

  it('no corpus word matches when preceded by a lead-in', () => {
    for (const w of ORDINARY_WORDS) expect(matchMagicWords([`say ${w}`]), w).toBeNull()
  })
})
