// Web Speech API adapter (spec: voice-input, Requirement 3, design 3.3).
// This is the ONLY module under src whose code names SpeechRecognition* identifiers
// or webkitSpeechRecognition. It declares its own structural types because
// TypeScript 7.0.2's DOM lib does not declare SpeechRecognition (spike-results.md #14).
// No audio is read, stored or logged; only transcript strings leave this file.

import { MAX_ALTERNATIVES, PHRASE_BOOST } from './config';
import type {
  ProviderCallbacks,
  SpeechProvider,
  StartOptions,
  VoiceErrorCode,
} from './speech-provider';

interface SpeechRecognitionLikeAlternative {
  readonly transcript?: unknown;
}

interface SpeechRecognitionLikeResult {
  readonly isFinal?: unknown;
  readonly length?: unknown;
  readonly [index: number]: SpeechRecognitionLikeAlternative | undefined;
}

interface SpeechRecognitionLikeResultList {
  readonly length?: unknown;
  readonly [index: number]: SpeechRecognitionLikeResult | undefined;
}

interface SpeechRecognitionLikeEvent {
  readonly resultIndex?: unknown;
  readonly results?: SpeechRecognitionLikeResultList;
  readonly error?: unknown;
}

type SpeechRecognitionLikeHandler = ((event: SpeechRecognitionLikeEvent) => void) | null;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  phrases?: unknown;
  onstart: SpeechRecognitionLikeHandler;
  onresult: SpeechRecognitionLikeHandler;
  onerror: SpeechRecognitionLikeHandler;
  onend: SpeechRecognitionLikeHandler;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionLikeConstructor = new () => SpeechRecognitionLike;
type SpeechRecognitionLikePhraseConstructor = new (phrase: string, boost: number) => unknown;

/** The provider plus the two detection helpers used by detect.ts through browser.ts. */
export interface WebSpeechProvider extends SpeechProvider {
  /** True when a recognition constructor exists. No construction, no side effects. */
  hasRecognition(): boolean;
  /** Constructs one recognition object and discards it. A throw propagates. */
  probe(): void;
}

interface AdapterSession {
  rec: SpeechRecognitionLike;
  dead: boolean;
  startedNotified: boolean;
  finalDelivered: boolean;
  errorDelivered: boolean;
  phrasesSet: boolean;
  retried: boolean;
  options: StartOptions | undefined;
}

/** Requirement 3.4: total mapping of recognition error strings. */
export function mapRecognitionError(error: unknown): VoiceErrorCode {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'audio-capture':
      return 'no-device';
    case 'network':
      return 'network';
    case 'no-speech':
      return 'no-speech';
    case 'language-not-supported':
      return 'unsupported-language';
    case 'aborted':
      return 'aborted';
    default:
      return 'other';
  }
}

function resolveConstructor(win: object): SpeechRecognitionLikeConstructor | undefined {
  const w = win as Record<string, unknown>;
  const plain = w['SpeechRecognition'];
  if (typeof plain === 'function') return plain as SpeechRecognitionLikeConstructor;
  const prefixed = w['webkitSpeechRecognition'];
  if (typeof prefixed === 'function') return prefixed as SpeechRecognitionLikeConstructor;
  return undefined;
}

function bestTranscript(result: SpeechRecognitionLikeResult | undefined): string {
  const first = result?.[0]?.transcript;
  return typeof first === 'string' ? first : '';
}

/** Creates the Web Speech provider. `win` is globalThis in production, a stub in tests. */
export function createWebSpeechProvider(callbacks: ProviderCallbacks, win: object): WebSpeechProvider {
  let current: AdapterSession | undefined;

  function applyPhrases(session: AdapterSession): void {
    const phrases = session.options?.phrases;
    if (!Array.isArray(phrases) || phrases.length === 0) return;
    const rec = session.rec;
    const phraseCtor = (win as Record<string, unknown>)['SpeechRecognitionPhrase'];
    if (typeof phraseCtor !== 'function' || !('phrases' in rec)) return;
    try {
      const Ctor = phraseCtor as SpeechRecognitionLikePhraseConstructor;
      rec.phrases = phrases
        .filter((p): p is string => typeof p === 'string')
        .map((p) => new Ctor(p, PHRASE_BOOST));
      session.phrasesSet = true;
    } catch {
      // Requirement 3.7: a throwing phrase setting is ignored.
    }
  }

  /** Builds a recognition object with fixed settings and handlers; throws if start() throws. */
  function launch(session: AdapterSession, withPhrases: boolean): void {
    const Ctor = resolveConstructor(win);
    if (Ctor === undefined) throw new Error('no recognition');
    const rec = new Ctor();
    session.rec = rec;
    session.phrasesSet = false;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = MAX_ALTERNATIVES;
    const live = (): boolean => current === session && !session.dead && session.rec === rec;
    rec.onstart = () => {
      if (!live() || session.startedNotified) return;
      session.startedNotified = true;
      callbacks.onStart();
    };
    rec.onresult = (event) => {
      if (!live() || session.finalDelivered) return;
      handleResult(session, event);
    };
    rec.onerror = (event) => {
      if (!live() || session.errorDelivered) return;
      const raw = event?.error;
      if (raw === 'phrases-not-supported' && session.phrasesSet && !session.retried) {
        session.retried = true;
        try {
          launch(session, false);
          return;
        } catch {
          session.errorDelivered = true;
          callbacks.onError('other');
          return;
        }
      }
      session.errorDelivered = true;
      callbacks.onError(mapRecognitionError(raw));
    };
    rec.onend = () => {
      if (!live()) return;
      current = undefined;
      session.dead = true;
      if (!session.finalDelivered && !session.errorDelivered) {
        session.errorDelivered = true;
        callbacks.onError('no-speech');
      }
      callbacks.onEnd();
    };
    if (withPhrases) applyPhrases(session);
    rec.start();
  }

  function handleResult(session: AdapterSession, event: SpeechRecognitionLikeEvent): void {
    const results = event?.results;
    if (results === undefined || results === null) return;
    const count = typeof results.length === 'number' ? results.length : 0;
    const startIndex =
      typeof event.resultIndex === 'number' && event.resultIndex >= 0 ? Math.floor(event.resultIndex) : 0;
    for (let i = startIndex; i < count; i++) {
      const result = results[i];
      if (result?.isFinal !== true) continue;
      const length = typeof result.length === 'number' ? result.length : 0;
      if (length < 1) continue; // empty final: remembered as "no result"
      const alternatives: string[] = [];
      for (let j = 0; j < Math.min(length, MAX_ALTERNATIVES); j++) {
        const t = result[j]?.transcript;
        alternatives.push(typeof t === 'string' ? t : '');
      }
      session.finalDelivered = true;
      callbacks.onFinal(alternatives);
      return;
    }
    const parts: string[] = [];
    for (let i = 0; i < count; i++) parts.push(bestTranscript(results[i]));
    callbacks.onInterim(parts.join(' '));
  }

  return {
    hasRecognition(): boolean {
      return resolveConstructor(win) !== undefined;
    },

    probe(): void {
      const Ctor = resolveConstructor(win);
      if (Ctor === undefined) throw new Error('no recognition');
      void new Ctor();
    },

    isSupported(): boolean {
      try {
        return resolveConstructor(win) !== undefined && (win as Record<string, unknown>)['isSecureContext'] === true;
      } catch {
        return false;
      }
    },

    start(options?: StartOptions): void {
      if (current !== undefined) throw new Error('session running');
      const session: AdapterSession = {
        rec: undefined as unknown as SpeechRecognitionLike,
        dead: false,
        startedNotified: false,
        finalDelivered: false,
        errorDelivered: false,
        phrasesSet: false,
        retried: false,
        options,
      };
      current = session;
      try {
        launch(session, true);
      } catch (error) {
        session.dead = true;
        if (current === session) current = undefined;
        throw error;
      }
    },

    stop(): void {
      const c = current;
      if (c === undefined) return;
      try {
        c.rec.stop();
      } catch {
        // never throws
      }
    },

    abort(): void {
      const c = current;
      if (c === undefined) return;
      current = undefined;
      c.dead = true;
      try {
        c.rec.abort();
      } catch {
        // never throws
      }
    },
  };
}
