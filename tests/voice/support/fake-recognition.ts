// Fake SpeechRecognition for voice tests (shape verified in spike-results.md).
// Records property writes, throws InvalidStateError on a second start() before end,
// and lets tests emit start, result, error and end events.

export class FakeSpeechRecognitionPhrase {
  constructor(
    public phrase: string,
    public boost: number,
  ) {}
}

export interface FakeAlternative {
  transcript: string
  confidence: number
}

export interface FakeResultSpec {
  isFinal: boolean
  alternatives: Array<string | FakeAlternative>
}

type Handler = ((event: any) => void) | null

let constructions = 0
let startCalls = 0
const instances: FakeSpeechRecognition[] = []

export class FakeSpeechRecognition {
  /** Set false before install to simulate a browser without contextual biasing. */
  static supportPhrases = true

  /** Property writes in order: [name, value]. */
  readonly writes: Array<[string, unknown]> = []
  readonly calls: string[] = []

  onstart: Handler = null
  onresult: Handler = null
  onerror: Handler = null
  onend: Handler = null
  onaudiostart: Handler = null
  onspeechstart: Handler = null

  started = false
  private _lang = ''
  private _continuous = false
  private _interimResults = false
  private _maxAlternatives = 1
  private _phrases: unknown[] = []
  private listeners = new Map<string, Array<(e: any) => void>>()

  constructor() {
    constructions++
    instances.push(this)
    if (FakeSpeechRecognition.supportPhrases) {
      Object.defineProperty(this, 'phrases', {
        get: () => this._phrases,
        set: (v: unknown[]) => {
          this.writes.push(['phrases', v])
          this._phrases = v
        },
        enumerable: true,
        configurable: true,
      })
    }
  }

  static get constructions(): number {
    return constructions
  }
  static get startCalls(): number {
    return startCalls
  }
  static get instances(): readonly FakeSpeechRecognition[] {
    return instances
  }
  static get last(): FakeSpeechRecognition | undefined {
    return instances[instances.length - 1]
  }
  static resetCounters(): void {
    constructions = 0
    startCalls = 0
    instances.length = 0
    FakeSpeechRecognition.supportPhrases = true
  }

  get lang(): string {
    return this._lang
  }
  set lang(v: string) {
    this.writes.push(['lang', v])
    this._lang = v
  }
  get continuous(): boolean {
    return this._continuous
  }
  set continuous(v: boolean) {
    this.writes.push(['continuous', v])
    this._continuous = v
  }
  get interimResults(): boolean {
    return this._interimResults
  }
  set interimResults(v: boolean) {
    this.writes.push(['interimResults', v])
    this._interimResults = v
  }
  get maxAlternatives(): number {
    return this._maxAlternatives
  }
  set maxAlternatives(v: number) {
    this.writes.push(['maxAlternatives', v])
    this._maxAlternatives = v
  }

  addEventListener(type: string, fn: (e: any) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== fn),
    )
  }

  start(): void {
    this.calls.push('start')
    startCalls++
    if (this.started) throw new DOMException('already started', 'InvalidStateError')
    this.started = true
  }
  stop(): void {
    this.calls.push('stop')
  }
  abort(): void {
    this.calls.push('abort')
  }

  private fire(type: string, event: object): void {
    const handler = (this as unknown as Record<string, Handler>)['on' + type] ?? null
    const e = { type, ...event }
    handler?.(e)
    for (const l of [...(this.listeners.get(type) ?? [])]) l(e)
  }

  emitStart(): void {
    this.fire('start', {})
  }

  /** Emit a result event. `index` is the resultIndex. */
  emitResult(results: FakeResultSpec[], resultIndex = 0): void {
    const list = results.map((r) => {
      const alts = r.alternatives.map((a) =>
        typeof a === 'string' ? { transcript: a, confidence: 0.9 } : a,
      )
      const result: Record<number | string, unknown> = {
        isFinal: r.isFinal,
        length: alts.length,
        item: (i: number) => alts[i],
      }
      alts.forEach((a, i) => (result[i] = a))
      return result
    })
    const resultList: Record<number | string, unknown> = {
      length: list.length,
      item: (i: number) => list[i],
    }
    list.forEach((r, i) => (resultList[i] = r))
    this.fire('result', { resultIndex, results: resultList })
  }

  emitError(error: string, message = ''): void {
    this.fire('error', { error, message })
  }

  /** Emit end and allow start() again. */
  emitEnd(): void {
    this.started = false
    this.fire('end', {})
  }
}

let saved: Array<{ target: object; name: string; had: boolean; value: unknown }> = []

const NAMES = ['SpeechRecognition', 'webkitSpeechRecognition', 'SpeechRecognitionPhrase'] as const

/**
 * Install the fake on `target` (default globalThis). In happy-dom window === globalThis.
 * `prefixed` installs only webkitSpeechRecognition.
 */
export function installFakeRecognition(
  target: object = globalThis,
  options: { prefixed?: boolean; phrases?: boolean } = {},
): void {
  uninstallFakeRecognition()
  FakeSpeechRecognition.resetCounters()
  const record = (name: string): void => {
    saved.push({
      target,
      name,
      had: Object.prototype.hasOwnProperty.call(target, name),
      value: (target as Record<string, unknown>)[name],
    })
  }
  const define = (name: string, value: unknown): void => {
    record(name)
    Object.defineProperty(target, name, { value, configurable: true, writable: true })
  }
  if (!options.prefixed) define('SpeechRecognition', FakeSpeechRecognition)
  define('webkitSpeechRecognition', FakeSpeechRecognition)
  if (options.phrases !== false) define('SpeechRecognitionPhrase', FakeSpeechRecognitionPhrase)
}

export function uninstallFakeRecognition(): void {
  for (const s of saved.reverse()) {
    if (s.had) {
      Object.defineProperty(s.target, s.name, { value: s.value, configurable: true, writable: true })
    } else {
      delete (s.target as Record<string, unknown>)[s.name]
    }
  }
  saved = []
}

export { NAMES as FAKE_RECOGNITION_GLOBALS }
