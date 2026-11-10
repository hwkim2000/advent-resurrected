// Provider-agnostic speech input interface (spec: voice-input, Requirement 3).
// Deliberately free of any browser speech-recognition type or error string, so
// a hosted speech-to-text service can implement it later.

export type VoiceErrorCode =
  | 'denied'
  | 'no-device'
  | 'network'
  | 'no-speech'
  | 'unsupported-language'
  | 'aborted'
  | 'other';

/**
 * Callback order for one session (Requirement 3.9): onStart at most once, then
 * zero or more onInterim, then onFinal at most once, then onError at most once,
 * then onEnd exactly once and last. No callback after onEnd, and none at all
 * after abort().
 */
export interface ProviderCallbacks {
  onStart(): void;
  onInterim(text: string): void;
  /** 1..MAX_ALTERNATIVES strings in provider order, best first. */
  onFinal(alternatives: readonly string[]): void;
  onError(code: VoiceErrorCode): void;
  onEnd(): void;
}

/** Every field is optional; providers ignore fields they do not understand. */
export interface StartOptions {
  /** Words to bias recognition toward (contextual biasing), when supported. */
  readonly phrases?: readonly string[];
  readonly [hint: string]: unknown;
}

export interface SpeechProvider {
  /** No side effects, no microphone access, never throws. */
  isSupported(): boolean;
  /** Throws if a session is running (the running session is left unchanged); may throw for other reasons. */
  start(options?: StartOptions): void;
  /** Never throws; ignored when idle. */
  stop(): void;
  /** Never throws; ignored when idle; no callback follows. */
  abort(): void;
}
