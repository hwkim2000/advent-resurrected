// Adapter example tests (spec: voice-input, task 8.7; Requirements 3.4 to 3.7, 3.9 to 3.13).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_ALTERNATIVES, MAGIC_PHRASES, PHRASE_BOOST } from '../../src/voice/config'
import { createWebSpeechProvider, mapRecognitionError } from '../../src/voice/web-speech-adapter'
import type { ProviderCallbacks, SpeechProvider, VoiceErrorCode } from '../../src/voice/speech-provider'
import {
  FakeSpeechRecognition,
  FakeSpeechRecognitionPhrase,
  installFakeRecognition,
  uninstallFakeRecognition,
} from './support/fake-recognition'

type Call = [string, ...unknown[]]

function makeCallbacks(): { calls: Call[]; callbacks: ProviderCallbacks } {
  const calls: Call[] = []
  return {
    calls,
    callbacks: {
      onStart: () => void calls.push(['start']),
      onInterim: (t) => void calls.push(['interim', t]),
      onFinal: (a) => void calls.push(['final', [...a]]),
      onError: (c) => void calls.push(['error', c]),
      onEnd: () => void calls.push(['end']),
    },
  }
}

function makeWin(secure = true): Record<string, unknown> {
  const win: Record<string, unknown> = { isSecureContext: secure }
  installFakeRecognition(win)
  return win
}

function last(): FakeSpeechRecognition {
  const rec = FakeSpeechRecognition.last
  if (rec === undefined) throw new Error('no recognition constructed')
  return rec
}

const names = (calls: Call[]): string[] => calls.map((c) => c[0])

beforeEach(() => {
  FakeSpeechRecognition.resetCounters()
})
afterEach(() => {
  uninstallFakeRecognition()
})

describe('settings (3.5)', () => {
  it('writes the four fixed settings', () => {
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const w = new Map(last().writes)
    expect(w.get('lang')).toBe('en-US')
    expect(w.get('continuous')).toBe(false)
    expect(w.get('interimResults')).toBe(true)
    expect(w.get('maxAlternatives')).toBe(MAX_ALTERNATIVES)
    expect(last().calls).toEqual(['start'])
  })

  it('ignores options that try to change them', () => {
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start({ lang: 'de-DE', continuous: true, interimResults: false, maxAlternatives: 1 })
    const rec = last()
    expect(rec.lang).toBe('en-US')
    expect(rec.continuous).toBe(false)
    expect(rec.interimResults).toBe(true)
    expect(rec.maxAlternatives).toBe(MAX_ALTERNATIVES)
    for (const key of ['lang', 'continuous', 'interimResults', 'maxAlternatives']) {
      expect(rec.writes.filter(([n]) => n === key)).toHaveLength(1)
    }
  })
})

describe('constructor preference and isSupported (3.12)', () => {
  it('prefers SpeechRecognition over webkitSpeechRecognition', () => {
    class Plain extends FakeSpeechRecognition {}
    class Prefixed extends FakeSpeechRecognition {}
    const win: Record<string, unknown> = {
      isSecureContext: true,
      SpeechRecognition: Plain,
      webkitSpeechRecognition: Prefixed,
    }
    const { callbacks } = makeCallbacks()
    createWebSpeechProvider(callbacks, win).start()
    expect(last()).toBeInstanceOf(Plain)
  })

  it('falls back to the prefixed constructor', () => {
    const win: Record<string, unknown> = { isSecureContext: true }
    installFakeRecognition(win, { prefixed: true })
    expect(win['SpeechRecognition']).toBeUndefined()
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, win)
    expect(p.isSupported()).toBe(true)
    p.start()
    expect(FakeSpeechRecognition.constructions).toBe(1)
  })

  it('isSupported constructs nothing and starts nothing', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    expect(p.isSupported()).toBe(true)
    expect(p.isSupported()).toBe(true)
    expect(p.hasRecognition()).toBe(true)
    expect(FakeSpeechRecognition.constructions).toBe(0)
    expect(FakeSpeechRecognition.startCalls).toBe(0)
    expect(calls).toEqual([])
  })

  it('isSupported is false without a constructor or without a secure context, and never throws', () => {
    const { callbacks } = makeCallbacks()
    expect(createWebSpeechProvider(callbacks, {}).isSupported()).toBe(false)
    expect(createWebSpeechProvider(callbacks, makeWin(false)).isSupported()).toBe(false)
    const hostile = new Proxy({}, { get: () => { throw new Error('boom') } })
    expect(() => createWebSpeechProvider(callbacks, hostile).isSupported()).not.toThrow()
    expect(createWebSpeechProvider(callbacks, hostile).isSupported()).toBe(false)
  })

  it('probe constructs one object without starting it; throws when absent', () => {
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.probe()
    expect(FakeSpeechRecognition.constructions).toBe(1)
    expect(FakeSpeechRecognition.startCalls).toBe(0)
    expect(() => createWebSpeechProvider(callbacks, {}).probe()).toThrow()
  })
})

describe('error mapping (3.4)', () => {
  const table: Array<[unknown, VoiceErrorCode]> = [
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['audio-capture', 'no-device'],
    ['network', 'network'],
    ['no-speech', 'no-speech'],
    ['language-not-supported', 'unsupported-language'],
    ['aborted', 'aborted'],
    ['bad-grammar', 'other'],
    ['phrases-not-supported', 'other'],
    ['something-new', 'other'],
    ['', 'other'],
    [undefined, 'other'],
    [null, 'other'],
    [42, 'other'],
    [{}, 'other'],
    [['not-allowed'], 'other'],
  ]

  it.each(table)('mapRecognitionError(%j) is %s', (input, expected) => {
    expect(mapRecognitionError(input)).toBe(expected)
  })

  it.each(table)('error event %j reaches onError(%s) then onEnd', (input, expected) => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    // phrases were set, so a phrases-not-supported error triggers the retry; skip that case here.
    if (input === 'phrases-not-supported') return
    last().emitError(input as string)
    last().emitEnd()
    expect(calls).toEqual([['error', expected], ['end']])
  })

  it('a missing error field maps to other', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().onerror?.({} as never)
    last().emitEnd()
    expect(calls).toEqual([['error', 'other'], ['end']])
  })

  it('an error followed by end does not add no-speech; a second error is dropped', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().emitError('network')
    last().emitError('not-allowed')
    last().emitEnd()
    expect(calls).toEqual([['error', 'network'], ['end']])
  })
})

describe('phrases (3.7)', () => {
  it('offers the seven magic words with the boost when supported', () => {
    const { callbacks } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start({ phrases: MAGIC_PHRASES })
    const phrases = (last() as unknown as { phrases: FakeSpeechRecognitionPhrase[] }).phrases
    expect(phrases.map((p) => p.phrase)).toEqual([...MAGIC_PHRASES])
    expect(MAGIC_PHRASES.map((s) => s.toUpperCase())).toEqual(['XYZZY', 'PLUGH', 'PLOVER', 'FEE', 'FIE', 'FOE', 'FOO'])
    expect(phrases.every((p) => p instanceof FakeSpeechRecognitionPhrase && p.boost === PHRASE_BOOST)).toBe(true)
  })

  it('sets no phrases when none are requested', () => {
    const { callbacks } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    expect(last().writes.some(([n]) => n === 'phrases')).toBe(false)
  })

  it('starts normally when the recognition object has no phrases property', () => {
    FakeSpeechRecognition.supportPhrases = false
    const win: Record<string, unknown> = { isSecureContext: true }
    installFakeRecognition(win)
    FakeSpeechRecognition.supportPhrases = false
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, win).start({ phrases: MAGIC_PHRASES })
    expect(last().writes.some(([n]) => n === 'phrases')).toBe(false)
    expect(last().calls).toEqual(['start'])
    last().emitStart()
    expect(calls).toEqual([['start']])
  })

  it('starts normally when the phrase constructor is missing', () => {
    const win: Record<string, unknown> = { isSecureContext: true }
    installFakeRecognition(win, { phrases: false })
    const { callbacks } = makeCallbacks()
    createWebSpeechProvider(callbacks, win).start({ phrases: MAGIC_PHRASES })
    expect(last().calls).toEqual(['start'])
  })

  it('ignores a throwing phrase setting and still starts', () => {
    const win = makeWin()
    win['SpeechRecognitionPhrase'] = function Throwing(): never {
      throw new Error('bad phrase')
    }
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, win).start({ phrases: MAGIC_PHRASES })
    expect(last().calls).toEqual(['start'])
    last().emitStart()
    last().emitResult([{ isFinal: true, alternatives: ['hello'] }])
    last().emitEnd()
    expect(calls).toEqual([['start'], ['final', ['hello']], ['end']])
  })

  it('retries once without phrases on phrases-not-supported, with no error callback', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start({ phrases: MAGIC_PHRASES })
    const first = last()
    first.emitError('phrases-not-supported')
    expect(FakeSpeechRecognition.constructions).toBe(2)
    const second = last()
    expect(second).not.toBe(first)
    expect(second.writes.some(([n]) => n === 'phrases')).toBe(false)
    expect(second.calls).toEqual(['start'])
    expect(second.lang).toBe('en-US')
    expect(second.maxAlternatives).toBe(MAX_ALTERNATIVES)
    expect(calls).toEqual([])

    // The abandoned object is ignored, the new one drives the session.
    first.emitEnd()
    first.emitResult([{ isFinal: true, alternatives: ['stale'] }])
    expect(calls).toEqual([])
    second.emitStart()
    second.emitResult([{ isFinal: true, alternatives: ['go north'] }])
    second.emitEnd()
    expect(calls).toEqual([['start'], ['final', ['go north']], ['end']])
  })

  it('a second phrases-not-supported after the retry is not retried again', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start({ phrases: MAGIC_PHRASES })
    last().emitError('phrases-not-supported')
    last().emitError('phrases-not-supported')
    expect(FakeSpeechRecognition.constructions).toBe(2)
    expect(calls).toEqual([['error', 'other']])
  })
})

describe('final results (3.10, 3.11)', () => {
  it.each([1, 5])('delivers %i alternatives in order', (n) => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    const alts = Array.from({ length: n }, (_, i) => `alt ${i}`)
    last().emitStart()
    last().emitResult([{ isFinal: true, alternatives: alts }])
    last().emitEnd()
    expect(calls).toEqual([['start'], ['final', alts], ['end']])
  })

  it('truncates 8 alternatives to the first MAX_ALTERNATIVES, in order', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    const alts = Array.from({ length: 8 }, (_, i) => `alt ${i}`)
    last().emitResult([{ isFinal: true, alternatives: alts }])
    last().emitEnd()
    expect(calls).toEqual([['final', alts.slice(0, MAX_ALTERNATIVES)], ['end']])
  })

  it('a final with 0 alternatives gives no-speech then end and never onFinal', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().emitStart()
    last().emitResult([{ isFinal: true, alternatives: [] }])
    last().emitEnd()
    expect(names(calls)).not.toContain('final')
    expect(calls.slice(-2)).toEqual([['error', 'no-speech'], ['end']])
  })

  it('interim results are joined best-first and a later final is delivered once', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().emitResult([{ isFinal: false, alternatives: ['go'] }])
    last().emitResult([
      { isFinal: false, alternatives: ['go in'] },
      { isFinal: false, alternatives: ['side'] },
    ])
    last().emitResult([{ isFinal: true, alternatives: ['go inside', 'go in side'] }])
    last().emitResult([{ isFinal: true, alternatives: ['again'] }])
    last().emitEnd()
    expect(calls).toEqual([
      ['interim', 'go'],
      ['interim', 'go in side'],
      ['final', ['go inside', 'go in side']],
      ['end'],
    ])
  })

  it('ends with no result and no error as no-speech then end', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().emitStart()
    last().emitEnd()
    expect(calls).toEqual([['start'], ['error', 'no-speech'], ['end']])
  })

  it('calls onStart at most once', () => {
    const { callbacks, calls } = makeCallbacks()
    createWebSpeechProvider(callbacks, makeWin()).start()
    last().emitStart()
    last().emitStart()
    expect(calls).toEqual([['start']])
  })
})

describe('late events (3.6, 3.9)', () => {
  it('drops events after end, and allows a new session whose events work', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const old = last()
    old.emitResult([{ isFinal: true, alternatives: ['one'] }])
    old.emitEnd()
    const before = calls.length
    old.emitStart()
    old.emitResult([{ isFinal: false, alternatives: ['late'] }])
    old.emitError('network')
    old.emitEnd()
    expect(calls).toHaveLength(before)
    expect(names(calls).filter((n) => n === 'end')).toHaveLength(1)

    p.start()
    expect(last()).not.toBe(old)
    last().emitResult([{ isFinal: true, alternatives: ['two'] }])
    last().emitEnd()
    expect(calls.slice(before)).toEqual([['final', ['two']], ['end']])
  })

  it('abort calls rec.abort, then drops every event including end', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const rec = last()
    rec.emitStart()
    expect(calls).toEqual([['start']])
    p.abort()
    expect(rec.calls).toContain('abort')
    rec.emitResult([{ isFinal: false, alternatives: ['x'] }])
    rec.emitResult([{ isFinal: true, alternatives: ['y'] }])
    rec.emitError('aborted')
    rec.emitEnd()
    expect(calls).toEqual([['start']])
  })

  it('events of an aborted session do not leak into the next session', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const old = last()
    p.abort()
    p.start()
    const fresh = last()
    expect(fresh).not.toBe(old)
    old.emitResult([{ isFinal: true, alternatives: ['stale'] }])
    old.emitEnd()
    expect(calls).toEqual([])
    fresh.emitResult([{ isFinal: true, alternatives: ['fresh'] }])
    fresh.emitEnd()
    expect(calls).toEqual([['final', ['fresh']], ['end']])
  })

  it('stop forwards to the recognition object and the session still delivers its result', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    p.stop()
    expect(last().calls).toEqual(['start', 'stop'])
    last().emitResult([{ isFinal: true, alternatives: ['after stop'] }])
    last().emitEnd()
    expect(calls).toEqual([['final', ['after stop']], ['end']])
  })
})

describe('second start while running (3.13)', () => {
  it('throws, leaves the session unchanged, and calls no callback', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const rec = last()
    rec.emitStart()
    const writes = rec.writes.length
    expect(() => p.start()).toThrow()
    expect(FakeSpeechRecognition.constructions).toBe(1)
    expect(FakeSpeechRecognition.startCalls).toBe(1)
    expect(rec.writes).toHaveLength(writes)
    expect(calls).toEqual([['start']])

    rec.emitResult([{ isFinal: true, alternatives: ['still here'] }])
    rec.emitEnd()
    expect(calls).toEqual([['start'], ['final', ['still here']], ['end']])
  })
})

describe('idle stop and abort (3.12)', () => {
  it('do nothing and never throw', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    expect(() => p.stop()).not.toThrow()
    expect(() => p.abort()).not.toThrow()
    expect(FakeSpeechRecognition.constructions).toBe(0)
    expect(calls).toEqual([])
  })

  it('do nothing after the session ended', () => {
    const { callbacks, calls } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const rec = last()
    rec.emitResult([{ isFinal: true, alternatives: ['a'] }])
    rec.emitEnd()
    const recorded = [...rec.calls]
    p.stop()
    p.abort()
    expect(rec.calls).toEqual(recorded)
    expect(calls).toEqual([['final', ['a']], ['end']])
  })

  it('stop and abort swallow exceptions from the recognition object', () => {
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    const rec = last()
    rec.stop = () => {
      throw new Error('stop failed')
    }
    rec.abort = () => {
      throw new Error('abort failed')
    }
    expect(() => p.stop()).not.toThrow()
    expect(() => p.abort()).not.toThrow()
  })
})

describe('throwing rec.start()', () => {
  it('rethrows and clears the session so a later start works', () => {
    const { callbacks, calls } = makeCallbacks()
    const p: SpeechProvider = createWebSpeechProvider(callbacks, makeWin())
    const original = FakeSpeechRecognition.prototype.start
    FakeSpeechRecognition.prototype.start = function () {
      throw new DOMException('no', 'NotAllowedError')
    }
    try {
      expect(() => p.start()).toThrow(/no/)
    } finally {
      FakeSpeechRecognition.prototype.start = original
    }
    const failed = last()
    // Events from the failed object are ignored.
    failed.emitStart()
    failed.emitEnd()
    expect(calls).toEqual([])
    // The session is cleared: stop/abort are no-ops and start works again.
    p.stop()
    p.abort()
    expect(() => p.start()).not.toThrow()
    last().emitResult([{ isFinal: true, alternatives: ['ok'] }])
    last().emitEnd()
    expect(calls).toEqual([['final', ['ok']], ['end']])
  })

  it('the real double-start of the fake is never reached by the adapter', () => {
    const { callbacks } = makeCallbacks()
    const p = createWebSpeechProvider(callbacks, makeWin())
    p.start()
    expect(() => p.start()).toThrow()
    expect(FakeSpeechRecognition.startCalls).toBe(1)
  })
})
