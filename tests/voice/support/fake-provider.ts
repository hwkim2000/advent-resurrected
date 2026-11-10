// Conforming fake SpeechProvider for session-controller tests (design.md 3.2).
// Contract enforced by the emitters: per session onStart at most once, then
// onInterim*, then onFinal at most once, then onError at most once, then onEnd
// exactly once and last; nothing after onEnd; nothing at all after abort().
import type {
  ProviderCallbacks,
  SpeechProvider,
  StartOptions,
  VoiceErrorCode,
} from '../../../src/voice/speech-provider'

export type ProviderCall =
  | { type: 'isSupported' }
  | { type: 'start'; options: StartOptions | undefined }
  | { type: 'stop' }
  | { type: 'abort' }

export type ProviderEmission =
  | { type: 'start'; session: number }
  | { type: 'interim'; session: number; text: string }
  | { type: 'final'; session: number; alternatives: readonly string[] }
  | { type: 'error'; session: number; code: VoiceErrorCode }
  | { type: 'end'; session: number }

export interface FakeSpeechProviderOptions {
  supported?: boolean
  /** When set, `start` throws this value (once per call) instead of beginning a session. */
  startThrows?: unknown
  /** When true, `stop()` ends the running session with onEnd (as a real engine eventually does). */
  autoEndOnStop?: boolean
}

export class FakeSpeechProvider implements SpeechProvider {
  readonly calls: ProviderCall[] = []
  readonly emissions: ProviderEmission[] = []
  supported: boolean
  /** Configurable: any non-undefined value makes the next `start` calls throw it. */
  startThrows: unknown
  autoEndOnStop: boolean

  private callbacks: ProviderCallbacks | undefined
  /** Number of the current or last session; 0 before the first start. */
  private session = 0
  private running = false
  private started = false
  private finalled = false
  private errored = false
  private detached = false

  constructor(callbacks?: ProviderCallbacks, options: FakeSpeechProviderOptions = {}) {
    this.callbacks = callbacks
    this.supported = options.supported ?? true
    this.startThrows = options.startThrows
    this.autoEndOnStop = options.autoEndOnStop ?? false
  }

  /** Attach callbacks when the provider is built before its consumer. */
  bind(callbacks: ProviderCallbacks): void {
    this.callbacks = callbacks
  }

  // ---- SpeechProvider ----

  isSupported(): boolean {
    this.calls.push({ type: 'isSupported' })
    return this.supported
  }

  start(options?: StartOptions): void {
    this.calls.push({ type: 'start', options })
    if (this.running) throw new Error('FakeSpeechProvider: a session is already running')
    if (this.startThrows !== undefined) throw this.startThrows
    this.session += 1
    this.running = true
    this.started = false
    this.finalled = false
    this.errored = false
    this.detached = false
  }

  stop(): void {
    this.calls.push({ type: 'stop' })
    if (!this.running || this.detached) return
    if (this.autoEndOnStop) this.emitEnd()
  }

  abort(): void {
    this.calls.push({ type: 'abort' })
    if (!this.running) return
    // Detach: no callback follows for this session.
    this.detached = true
    this.running = false
  }

  // ---- Scripted emitters (each returns whether a callback was delivered) ----

  /** A session is running and has not been aborted or ended. */
  get active(): boolean {
    return this.running && !this.detached
  }

  get sessionNumber(): number {
    return this.session
  }

  /** Number of `start` calls that began a session (did not throw). */
  get startCount(): number {
    return this.session
  }

  get stopCount(): number {
    return this.calls.filter((c) => c.type === 'stop').length
  }

  get abortCount(): number {
    return this.calls.filter((c) => c.type === 'abort').length
  }

  /** Number of `start` calls, including ones that threw. */
  get startCalls(): number {
    return this.calls.filter((c) => c.type === 'start').length
  }

  emitStart(): boolean {
    if (!this.active || this.started) return false
    this.started = true
    this.emissions.push({ type: 'start', session: this.session })
    this.callbacks?.onStart()
    return true
  }

  emitInterim(text: string): boolean {
    if (!this.active || this.finalled || this.errored) return false
    this.ensureStarted()
    this.emissions.push({ type: 'interim', session: this.session, text })
    this.callbacks?.onInterim(text)
    return true
  }

  emitFinal(alternatives: readonly string[]): boolean {
    if (!this.active || this.finalled || this.errored) return false
    this.ensureStarted()
    this.finalled = true
    this.emissions.push({ type: 'final', session: this.session, alternatives })
    this.callbacks?.onFinal(alternatives)
    return true
  }

  emitError(code: VoiceErrorCode): boolean {
    if (!this.active || this.errored) return false
    this.ensureStarted()
    this.errored = true
    this.emissions.push({ type: 'error', session: this.session, code })
    this.callbacks?.onError(code)
    return true
  }

  emitEnd(): boolean {
    if (!this.active) return false
    this.ensureStarted()
    this.running = false
    this.emissions.push({ type: 'end', session: this.session })
    this.callbacks?.onEnd()
    return true
  }

  /** Clear the call log and emission log (session state is kept). */
  clearLog(): void {
    this.calls.length = 0
    this.emissions.length = 0
  }

  private ensureStarted(): void {
    if (!this.started) this.emitStart()
  }
}

/** Factory that builds a provider from callbacks and remembers it, for controllers that take a factory. */
export function createFakeProviderFactory(options: FakeSpeechProviderOptions = {}): {
  factory: (callbacks: ProviderCallbacks) => FakeSpeechProvider
  readonly provider: FakeSpeechProvider | undefined
} {
  let made: FakeSpeechProvider | undefined
  return {
    factory: (callbacks) => {
      made = new FakeSpeechProvider(callbacks, options)
      return made
    },
    get provider() {
      return made
    },
  }
}
