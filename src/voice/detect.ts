// Environment detection for the voice layer (spec: voice-input, Requirement 2).
// Feature test only: no user-agent sniffing. The browser-specific constructor
// lookup lives in the adapter and reaches this module as injected functions.
// This module never calls start(), getUserMedia or permissions.query: the
// shell queries the microphone permission itself, inside try/catch, after
// Ready has been reported (Requirement 2.11).

import type { VoiceErrorCode } from './speech-provider'

/** Minimal view of a permission status object (shell use). */
export interface PermissionStatusLike {
  state: string
  onchange: ((ev: unknown) => void) | null
}

/** Injected environment. Every member is a plain function or value. */
export interface DetectEnv {
  /** `window.isSecureContext`. */
  readonly isSecureContext: boolean
  /** True when a speech-recognition constructor exists (typeof test in the adapter). */
  hasRecognition(): boolean
  /** Constructs and discards one recognition object; may throw. */
  probe(): void
  /** Optional microphone permission query, used by the shell, not here. */
  queryMicrophone?(): Promise<PermissionStatusLike>
  /** Console log restricted to a Voice_Error_Code. */
  log(code: VoiceErrorCode): void
}

/** `unsupported`: no API or insecure context. `runtime`: probe threw. */
export type DetectFatal = 'unsupported' | 'runtime'

export interface DetectResult {
  /** Undefined means ready (Requirement 2.11). */
  readonly fatal?: DetectFatal
}

/** Runs once per page load (the caller caches the result, Requirement 2.12). */
export function detectEnvironment(env: DetectEnv): DetectResult {
  if (!env.isSecureContext || !env.hasRecognition()) {
    return { fatal: 'unsupported' }
  }
  try {
    env.probe()
  } catch {
    env.log('other')
    return { fatal: 'runtime' }
  }
  return {}
}
