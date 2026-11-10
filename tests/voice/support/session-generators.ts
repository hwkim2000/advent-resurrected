// Event-sequence arbitraries for Property 10 (session safety), design.md.
// Plain data: a test maps each SessionEvent onto the controller, the fake
// provider, the fake host and the fake scheduler.
import fc from 'fast-check'
import type { GamePhase } from '../../../src/ui/input-resolver'
import type { Mode, PromptKind } from '../../../src/ui/types'
import type { PointerKind, VoiceGestureEvent } from '../../../src/ui/voice-port'
import type { VoiceErrorCode } from '../../../src/voice/speech-provider'

export const ERROR_CODES: readonly VoiceErrorCode[] = [
  'denied',
  'no-device',
  'network',
  'no-speech',
  'unsupported-language',
  'aborted',
  'other',
]

export type SessionEvent =
  // Gestures, in the shape accepted by VoicePort.dispatch.
  | { kind: 'gesture'; event: VoiceGestureEvent }
  // Provider emissions.
  | { kind: 'provider-interim'; text: string }
  | { kind: 'provider-final'; alternatives: string[] }
  | { kind: 'provider-error'; code: VoiceErrorCode }
  | { kind: 'provider-end' }
  // The next provider.start call throws (once armed, it keeps throwing).
  | { kind: 'start-throws' }
  // Fake clock.
  | { kind: 'advance'; ms: number }
  // Game and host.
  | { kind: 'new-game'; mode: Mode }
  | { kind: 'switch-1976' }
  | { kind: 'host-change'; phase: GamePhase; promptKind: PromptKind | undefined }

const arbPointer: fc.Arbitrary<PointerKind> = fc.constantFrom<PointerKind>('mouse', 'pen', 'touch')
const arbMousePen: fc.Arbitrary<PointerKind> = fc.constantFrom<PointerKind>('mouse', 'pen')

const arbGesture: fc.Arbitrary<VoiceGestureEvent> = fc.oneof(
  { weight: 4, arbitrary: arbPointer.map((pointerType): VoiceGestureEvent => ({ type: 'pointer-down', pointerType })) },
  { weight: 4, arbitrary: arbPointer.map((pointerType): VoiceGestureEvent => ({ type: 'pointer-up', pointerType })) },
  { weight: 2, arbitrary: arbPointer.map((pointerType): VoiceGestureEvent => ({ type: 'pointer-cancel', pointerType })) },
  // Touch click and keyboard Enter/Space activation.
  { weight: 3, arbitrary: fc.constantFrom<'keyboard' | 'touch'>('keyboard', 'touch').map((via): VoiceGestureEvent => ({ type: 'button-activate', via })) },
  { weight: 3, arbitrary: fc.boolean().map((repeat): VoiceGestureEvent => ({ type: 'altm-down', repeat })) },
  { weight: 3, arbitrary: fc.constant<VoiceGestureEvent>({ type: 'altm-up' }) },
  { weight: 2, arbitrary: fc.constant<VoiceGestureEvent>({ type: 'escape' }) },
  { weight: 1, arbitrary: fc.constant<VoiceGestureEvent>({ type: 'window-blur' }) },
  { weight: 1, arbitrary: fc.constant<VoiceGestureEvent>({ type: 'page-hidden' }) },
  { weight: 1, arbitrary: fc.constant<VoiceGestureEvent>({ type: 'pagehide' }) },
)

/** Transcript text for a final alternative: empty, magic, ordinary, or Meta. */
const arbAlternativeText: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constant('') },
  { weight: 3, arbitrary: fc.constant('fee fie foe foo') },
  { weight: 2, arbitrary: fc.constantFrom('xyzzy', 'plugh', 'plover', 'north', 'take lamp', 'yes', 'no', 'quit') },
  { weight: 3, arbitrary: fc.string({ unit: 'binary-ascii', maxLength: 30 }) },
)

/** 1 to 5 alternatives, best first. */
export const arbFinalAlternatives: fc.Arbitrary<string[]> = fc.array(arbAlternativeText, {
  minLength: 1,
  maxLength: 5,
})

/** Clock advances of 0 to 20,000 ms, biased to the 250 ms hold threshold and the timeouts. */
export const arbAdvanceMs: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 20_000 }) },
  { weight: 3, arbitrary: fc.integer({ min: 200, max: 300 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 249, 250, 251, 20_000) },
)

const arbPromptKind: fc.Arbitrary<PromptKind | undefined> = fc.option(
  fc.constantFrom<PromptKind>('command', 'yesno', 'filename'),
  { nil: undefined },
)

export const arbSessionEvent: fc.Arbitrary<SessionEvent> = fc.oneof(
  { weight: 14, arbitrary: arbGesture.map((event): SessionEvent => ({ kind: 'gesture', event })) },
  { weight: 3, arbitrary: fc.string({ unit: 'binary-ascii', maxLength: 20 }).map((text): SessionEvent => ({ kind: 'provider-interim', text })) },
  { weight: 4, arbitrary: arbFinalAlternatives.map((alternatives): SessionEvent => ({ kind: 'provider-final', alternatives })) },
  { weight: 3, arbitrary: fc.constantFrom(...ERROR_CODES).map((code): SessionEvent => ({ kind: 'provider-error', code })) },
  { weight: 4, arbitrary: fc.constant<SessionEvent>({ kind: 'provider-end' }) },
  { weight: 1, arbitrary: fc.constant<SessionEvent>({ kind: 'start-throws' }) },
  { weight: 6, arbitrary: arbAdvanceMs.map((ms): SessionEvent => ({ kind: 'advance', ms })) },
  { weight: 1, arbitrary: fc.constantFrom<Mode>('1976', 'haunted').map((mode): SessionEvent => ({ kind: 'new-game', mode })) },
  { weight: 1, arbitrary: fc.constant<SessionEvent>({ kind: 'switch-1976' }) },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.constantFrom<GamePhase>('booting', 'ready', 'over', 'failed'), arbPromptKind)
      .map(([phase, promptKind]): SessionEvent => ({ kind: 'host-change', phase, promptKind })),
  },
)

/** Sequences of 0 to 60 events. */
export const arbSessionEvents: fc.Arbitrary<SessionEvent[]> = fc.array(arbSessionEvent, { maxLength: 60 })

// ---- Focused, well-formed gesture arbitraries ----

/** One touch tap: press, release, then the touch click. */
export const arbTouchTap: fc.Arbitrary<SessionEvent[]> = fc.constant<SessionEvent[]>([
  { kind: 'gesture', event: { type: 'pointer-down', pointerType: 'touch' } },
  { kind: 'gesture', event: { type: 'pointer-up', pointerType: 'touch' } },
  { kind: 'gesture', event: { type: 'button-activate', via: 'touch' } },
])

/** One mouse or pen hold: press, an advance (hold time around 250 ms), release. */
export const arbHold: fc.Arbitrary<SessionEvent[]> = fc
  .tuple(arbMousePen, fc.integer({ min: 200, max: 300 }))
  .map(([pointerType, ms]): SessionEvent[] => [
    { kind: 'gesture', event: { type: 'pointer-down', pointerType } },
    { kind: 'advance', ms },
    { kind: 'gesture', event: { type: 'pointer-up', pointerType } },
  ])

/** Mixed sequences of whole taps and holds interleaved with arbitrary events. */
export const arbGestureSequence: fc.Arbitrary<SessionEvent[]> = fc
  .array(fc.oneof(arbTouchTap, arbHold, arbSessionEvent.map((e) => [e])), { maxLength: 20 })
  .map((parts) => parts.flat())
