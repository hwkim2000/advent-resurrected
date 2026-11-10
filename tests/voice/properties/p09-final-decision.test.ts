// Feature: voice-input, Property 9: The final-result decision follows the fixed check order
// Validates: Requirements 8.3, 8.4, 8.11, 8.12, 9.1, 9.2, 9.3, 9.5, 9.6, 9.9, 9.12, 10.16, 11.7
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isMetaWord } from '../../../src/shared/meta-commands'
import { cleanTranscript } from '../../../src/voice/clean'
import { decideFinal, type FinalOutcome, type HostSnapshot } from '../../../src/voice/final-result'
import { matchMagicWords } from '../../../src/voice/magic-match'
import { DIDNT_CATCH, TYPE_FILE_NAME, TYPE_THAT_COMMAND } from '../../../src/voice/messages'
import {
  arbAlternative,
  arbAlternatives,
  arbCleanedText,
  arbHostSnapshot,
  arbMetaLine,
  arbStringAlternatives,
} from '../support/generators'
import { voiceAssert } from '../support/pbt'

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'affirmative'])
const NO = new Set(['no', 'nope', 'nah', 'negative'])

/** Independent reference table: Requirement 8.12 steps a to g. */
function reference(alts: readonly unknown[], host: HostSnapshot): FinalOutcome {
  // a
  if (
    host.phase !== 'ready' ||
    host.promptKind === undefined ||
    host.gameMode === undefined ||
    host.gameMode !== 'haunted'
  ) {
    return { kind: 'silent' }
  }
  // b
  if (host.promptKind === 'filename') return { kind: 'message', text: TYPE_FILE_NAME }
  const first = cleanTranscript(alts[0])
  // c
  if (first.replace(/[^a-z0-9]/g, '') === '') return { kind: 'message', text: DIDNT_CATCH }
  const meta = first
    .split(' ')
    .filter((t) => t !== '')
    .slice(0, 2)
    .some((t) => isMetaWord(t))
  // d
  if (host.promptKind === 'yesno') {
    if (YES.has(first)) return { kind: 'submit', lines: ['YES'], heard: first }
    if (NO.has(first)) return { kind: 'submit', lines: ['NO'], heard: first }
    if (meta) return { kind: 'message', text: TYPE_THAT_COMMAND }
    return { kind: 'submit', lines: [first], heard: first }
  }
  // e
  const m = matchMagicWords(alts)
  if (m !== null) {
    return { kind: 'submit', lines: [...m.commands], heard: cleanTranscript(alts[m.alternativeIndex]) }
  }
  // f
  if (meta) return { kind: 'message', text: TYPE_THAT_COMMAND }
  // g
  return { kind: 'submit', lines: [first], heard: first }
}

const ready = (promptKind: HostSnapshot['promptKind']): HostSnapshot => ({
  gameMode: 'haunted',
  promptKind,
  phase: 'ready',
})

describe('Property 9: final-result decision order', () => {
  it('equals the reference table for any alternatives and host snapshot', () => {
    voiceAssert(
      fc.property(arbAlternatives, arbHostSnapshot, (alts, host) => {
        expect(decideFinal(alts, host)).toEqual(reference(alts, host))
      }),
      300,
    )
  })

  it('equals the reference for ready haunted hosts with realistic alternative lists', () => {
    voiceAssert(
      fc.property(
        fc.oneof(arbStringAlternatives, fc.array(arbAlternative, { maxLength: 5 })),
        fc.constantFrom<HostSnapshot['promptKind']>('command', 'yesno', 'filename'),
        (alts, kind) => {
          expect(decideFinal(alts, ready(kind))).toEqual(reference(alts, ready(kind)))
        },
      ),
      300,
    )
  })

  it('is silent unless phase is ready, mode is haunted and the prompt kind is known', () => {
    voiceAssert(
      fc.property(arbAlternatives, arbHostSnapshot, (alts, host) => {
        const active = host.phase === 'ready' && host.gameMode === 'haunted' && host.promptKind !== undefined
        if (!active) expect(decideFinal(alts, host)).toEqual({ kind: 'silent' })
      }),
    )
  })

  it('withholds Meta words in the first two tokens at command and yes/no prompts', () => {
    voiceAssert(
      fc.property(arbMetaLine, fc.constantFrom<HostSnapshot['promptKind']>('command', 'yesno'), (line, kind) => {
        expect(decideFinal([line], ready(kind))).toEqual({ kind: 'message', text: TYPE_THAT_COMMAND })
      }),
    )
  })

  it('passes a Meta word in third position or later', () => {
    voiceAssert(
      fc.property(arbCleanedText.filter((t) => t.length > 0), (_t) => {
        const out = decideFinal(['go to the quit'], ready('command'))
        expect(out).toEqual({ kind: 'submit', lines: ['go to the quit'], heard: 'go to the quit' })
      }),
    )
  })

  it('maps yes/no only from the first alternative and never calls the matcher at a yes/no prompt', () => {
    expect(decideFinal(['yes', 'xyzzy'], ready('yesno'))).toEqual({ kind: 'submit', lines: ['YES'], heard: 'yes' })
    expect(decideFinal(['maybe', 'yes'], ready('yesno'))).toEqual({
      kind: 'submit',
      lines: ['maybe'],
      heard: 'maybe',
    })
    const xyz = decideFinal(['xyzzy'], ready('yesno'))
    expect(xyz).toEqual({ kind: 'submit', lines: ['xyzzy'], heard: 'xyzzy' })
  })

  it('never throws', () => {
    voiceAssert(
      fc.property(fc.anything(), fc.anything(), (alts, host) => {
        const out = decideFinal(alts as unknown[], host as HostSnapshot)
        expect(['silent', 'message', 'submit']).toContain(out.kind)
      }),
    )
  })
})
