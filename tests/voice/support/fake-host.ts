// Fake VoiceLayerHost (src/ui/voice-port.ts) with mutable state and recorded calls.
import type { GamePhase } from '../../../src/ui/input-resolver'
import type { InputOrigin, Mode, PromptKind } from '../../../src/ui/types'
import type { VoiceLayerHost } from '../../../src/ui/voice-port'

export interface SubmittedLine {
  line: string
  origin: InputOrigin
}

export interface LogEntry {
  message: string
  cause: unknown
}

export class FakeHost implements VoiceLayerHost {
  promptKind: PromptKind | undefined
  phase: GamePhase | undefined
  gameMode: Mode | undefined
  /** Every submit, in call order. */
  readonly submitted: SubmittedLine[] = []
  /** Every log.error call, in call order. */
  readonly logged: LogEntry[] = []

  constructor(
    initial: { promptKind?: PromptKind; phase?: GamePhase; gameMode?: Mode } = {},
  ) {
    this.promptKind = 'promptKind' in initial ? initial.promptKind : 'command'
    this.phase = 'phase' in initial ? initial.phase : 'ready'
    this.gameMode = 'gameMode' in initial ? initial.gameMode : 'haunted'
  }

  /** Same object each time so `host.log` identity is stable. */
  readonly log = {
    error: (message: string, cause?: unknown): void => {
      this.logged.push({ message, cause })
    },
  }

  submit(line: string, origin: InputOrigin): void {
    this.submitted.push({ line, origin })
  }

  /** Number of log.error calls. */
  get logCount(): number {
    return this.logged.length
  }

  /** Lines only, in order. */
  get lines(): string[] {
    return this.submitted.map((s) => s.line)
  }

  /** Set several host fields at once (each key present is applied, even when undefined). */
  set(change: { promptKind?: PromptKind | undefined; phase?: GamePhase | undefined; gameMode?: Mode | undefined }): void {
    if ('promptKind' in change) this.promptKind = change.promptKind
    if ('phase' in change) this.phase = change.phase
    if ('gameMode' in change) this.gameMode = change.gameMode
  }

  clearRecords(): void {
    this.submitted.length = 0
    this.logged.length = 0
  }
}
