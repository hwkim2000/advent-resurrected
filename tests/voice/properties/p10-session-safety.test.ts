// Feature: voice-input, Property 10: Session safety invariants hold for every event sequence
// Validates: Requirements 18.4
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { GamePhase } from '../../../src/ui/input-resolver'
import type { PromptKind } from '../../../src/ui/types'
import { VOICE_NOT_AVAILABLE } from '../../../src/voice/messages'
import { createVoiceLayer } from '../../../src/voice/session-controller'
import type { ProviderCallbacks, StartOptions } from '../../../src/voice/speech-provider'
import { FakeHost } from '../support/fake-host'
import { FakeSpeechProvider } from '../support/fake-provider'
import { FakeScheduler } from '../support/fake-scheduler'
import { voiceAssert } from '../support/pbt'
import { arbSessionEvents, arbTouchTap, ERROR_CODES, type SessionEvent } from '../support/session-generators'

const SEQUENCE = ['FEE', 'FIE', 'FOE', 'FOO']

interface HostFacts {
  phase: GamePhase | undefined
  promptKind: PromptKind | undefined
  gameMode: string | undefined
}

/** Fake provider that reports protocol violations of the controller. */
class ProbeProvider extends FakeSpeechProvider {
  readonly violations: string[] = []
  readonly startHosts: HostFacts[] = []
  /** Stop calls since the last successful start. */
  stopsThisSession = 0
  constructor(
    callbacks: ProviderCallbacks,
    private readonly host: FakeHost,
  ) {
    super(callbacks)
  }
  override start(options?: StartOptions): void {
    this.startHosts.push({ phase: this.host.phase, promptKind: this.host.promptKind, gameMode: this.host.gameMode })
    if (this.active) this.violations.push('start while a session is running')
    super.start(options)
    this.stopsThisSession = 0
  }
  override stop(): void {
    this.stopsThisSession += 1
    if (this.stopsThisSession > 1) this.violations.push('stop called twice in one session')
    super.stop()
  }
}

/** Runs the events against a real controller and checks every invariant after each event. */
function run(events: readonly SessionEvent[]): void {
  const host = new FakeHost()
  const scheduler = new FakeScheduler()
  let provider: ProbeProvider | undefined
  let callbacks: ProviderCallbacks | undefined
  let armed = false
  const layer = createVoiceLayer({
    host,
    scheduler,
    env: { isSecureContext: true, hasRecognition: () => true, probe: () => undefined, log: () => undefined },
    createProvider: (cb) => {
      callbacks = cb
      provider = new ProbeProvider(cb, host)
      if (armed) provider.startThrows = new Error('start failed')
      return provider
    },
  })
  layer.gameStart('haunted')

  const startCalls = (): number => provider?.startCalls ?? 0
  const startCount = (): number => provider?.startCount ?? 0
  const stopCount = (): number => provider?.stopCount ?? 0
  const abortCount = (): number => provider?.abortCount ?? 0
  const sessionNo = (): number => provider?.sessionNumber ?? 0
  const linesPerSession = new Map<number, number>()
  const logsPerAttempt = new Map<number, number>()
  let loggedSeen = 0
  let startCallsAtThrow = -1
  const finalsDelivered = new Set<number>()

  for (const ev of events) {
    const before = {
      startCalls: startCalls(),
      startCount: startCount(),
      stops: stopCount(),
      aborts: abortCount(),
      active: provider?.active ?? false,
      submitted: host.submitted.length,
      host: { phase: host.phase, promptKind: host.promptKind, gameMode: host.gameMode } as HostFacts,
    }
    let finalDelivered = false
    let forcedSecondFinal = false

    switch (ev.kind) {
      case 'gesture':
        layer.port.dispatch(ev.event)
        break
      case 'provider-interim':
        provider?.emitInterim(ev.text)
        break
      case 'provider-final':
        if (provider !== undefined) {
          const no = sessionNo()
          if (provider.emitFinal(ev.alternatives)) {
            finalDelivered = true
            finalsDelivered.add(no)
          } else if (provider.active && finalsDelivered.has(no) && callbacks !== undefined) {
            // A misbehaving second final must still submit nothing.
            forcedSecondFinal = true
            callbacks.onFinal(ev.alternatives)
          }
        }
        break
      case 'provider-error':
        provider?.emitError(ev.code)
        break
      case 'provider-end':
        provider?.emitEnd()
        break
      case 'start-throws':
        armed = true
        if (provider !== undefined) provider.startThrows = new Error('start failed')
        break
      case 'advance':
        scheduler.advance(ev.ms)
        break
      case 'new-game':
        host.set({ gameMode: ev.mode, phase: 'ready', promptKind: 'command' })
        layer.gameStart(ev.mode)
        break
      case 'switch-1976':
        host.set({ gameMode: '1976' })
        layer.gameStart('1976')
        break
      case 'host-change':
        host.set({ phase: ev.phase, promptKind: ev.promptKind })
        break
    }
    layer.syncHost()

    const startsDelta = startCalls() - before.startCalls
    const stopsDelta = stopCount() - before.stops
    const abortsDelta = abortCount() - before.aborts
    const view = layer.port.getView()

    // Protocol violations recorded by the probe (double start, double stop).
    expect(provider?.violations ?? []).toEqual([])

    // At most one session; pressed equals "a session exists".
    expect(startsDelta).toBeLessThanOrEqual(1)
    expect(view.pressed).toBe(layer.listening)
    if (provider?.active === true) expect(view.pressed).toBe(true)

    // Mic disabled exactly by phase / prompt; no start while disabled or not haunted.
    const expectDisabled =
      host.phase !== 'ready' || host.promptKind === undefined || host.promptKind === 'filename'
    expect(view.disabled).toBe(expectDisabled)
    if (startsDelta === 1 && provider !== undefined) {
      const h = provider.startHosts[provider.startHosts.length - 1] as HostFacts
      expect(h.phase).toBe('ready')
      expect(h.promptKind === undefined || h.promptKind === 'filename').toBe(false)
      expect(h.gameMode).toBe('haunted')
    }

    // Touch pointer events never start, stop or abort; one touch click is one start or one stop.
    if (ev.kind === 'gesture') {
      const g = ev.event
      if ((g.type === 'pointer-down' || g.type === 'pointer-up' || g.type === 'pointer-cancel') && g.pointerType === 'touch') {
        expect([startsDelta, stopsDelta, abortsDelta]).toEqual([0, 0, 0])
      }
      if (g.type === 'button-activate' && g.via === 'touch') {
        expect(startsDelta + stopsDelta).toBeLessThanOrEqual(1)
      }
    }

    // A release (or anything) after the session ended calls neither stop nor abort.
    if (!before.active && startsDelta === 0) {
      expect(stopsDelta).toBe(0)
      expect(abortsDelta).toBe(0)
    }

    // A start that throws: Unavailable (never Busy), only the fixed message, never started again.
    if (startsDelta === 1 && startCount() === before.startCount) {
      startCallsAtThrow = startCalls()
      expect(view.availability).toBe('Unavailable')
      expect(view.status).toBe(VOICE_NOT_AVAILABLE)
    }
    if (startCallsAtThrow >= 0) expect(startCalls()).toBe(startCallsAtThrow)

    // Submitted lines: only from one delivered final, haunted + ready, one utterance per session.
    const delta = host.submitted.slice(before.submitted)
    if (delta.length > 0) {
      expect(finalDelivered).toBe(true)
      expect(forcedSecondFinal).toBe(false)
      expect(before.host.gameMode).toBe('haunted')
      expect(before.host.phase).toBe('ready')
      expect(delta.length).toBeLessThanOrEqual(4)
      for (const s of delta) expect(s.origin).toBe('spoken')
      if (delta.length > 1) {
        expect(delta.map((s) => s.line.toUpperCase())).toEqual(SEQUENCE.slice(0, delta.length))
      }
      const no = sessionNo()
      linesPerSession.set(no, (linesPerSession.get(no) ?? 0) + 1)
      expect(linesPerSession.get(no)).toBe(1)
    }

    // At most one console entry per start attempt, code only (no Spoken_Text).
    for (; loggedSeen < host.logged.length; loggedSeen++) {
      const msg = host.logged[loggedSeen]?.message ?? ''
      expect(msg).toMatch(/^voice: [a-z-]+$/)
      expect(ERROR_CODES as readonly string[]).toContain(msg.slice('voice: '.length))
      const attempt = startCalls()
      logsPerAttempt.set(attempt, (logsPerAttempt.get(attempt) ?? 0) + 1)
      expect(logsPerAttempt.get(attempt)).toBeLessThanOrEqual(1)
    }
  }

}

describe('Property 10: session safety invariants', () => {
  it('holds for every event sequence', () => {
    voiceAssert(fc.property(arbSessionEvents, (events) => run(events)), 300)
  })

  it('one touch tap causes at most one start or one stop', () => {
    voiceAssert(
      fc.property(arbSessionEvents, arbTouchTap, (prefix, tap) => {
        // Run the prefix to reach an arbitrary state, then compare call counts across the tap.
        const host = new FakeHost()
        const scheduler = new FakeScheduler()
        let provider: ProbeProvider | undefined
        const layer = createVoiceLayer({
          host,
          scheduler,
          env: { isSecureContext: true, hasRecognition: () => true, probe: () => undefined, log: () => undefined },
          createProvider: (cb) => (provider = new ProbeProvider(cb, host)),
        })
        layer.gameStart('haunted')
        for (const ev of prefix) {
          if (ev.kind === 'gesture') layer.port.dispatch(ev.event)
          else if (ev.kind === 'advance') scheduler.advance(ev.ms)
          else if (ev.kind === 'provider-final') provider?.emitFinal(ev.alternatives)
          else if (ev.kind === 'provider-end') provider?.emitEnd()
          else if (ev.kind === 'provider-error') provider?.emitError(ev.code)
          else if (ev.kind === 'host-change') {
            host.set({ phase: ev.phase, promptKind: ev.promptKind })
            layer.syncHost()
          }
        }
        const s0 = provider?.startCalls ?? 0
        const t0 = provider?.stopCount ?? 0
        for (const ev of tap) if (ev.kind === 'gesture') layer.port.dispatch(ev.event)
        const total = (provider?.startCalls ?? 0) - s0 + ((provider?.stopCount ?? 0) - t0)
        expect(total).toBeLessThanOrEqual(1)
      }),
    )
  })

  it('a touch tap starts a latch session, the next stops it (example)', () => {
    const host = new FakeHost()
    let provider: ProbeProvider | undefined
    const layer = createVoiceLayer({
      host,
      scheduler: new FakeScheduler(),
      env: { isSecureContext: true, hasRecognition: () => true, probe: () => undefined, log: () => undefined },
      createProvider: (cb) => (provider = new ProbeProvider(cb, host)),
    })
    layer.gameStart('haunted')
    layer.port.dispatch({ type: 'pointer-down', pointerType: 'touch' })
    layer.port.dispatch({ type: 'pointer-up', pointerType: 'touch' })
    expect(provider).toBeUndefined()
    layer.port.dispatch({ type: 'button-activate', via: 'touch' })
    expect(provider?.startCalls).toBe(1)
    layer.port.dispatch({ type: 'button-activate', via: 'touch' })
    expect(provider?.stopCount).toBe(1)
  })
})
