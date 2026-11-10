// Pure speech queue policy for Ghost_Voice: one item plays, at most one waits,
// a newer offer replaces the waiting one, and a waiting item older than
// MAX_WAIT_MS is dropped. No timers, no DOM: the player and the clock are injected.

export const MAX_WAIT_MS = 8000;

export interface SpeechPlayer<T> {
  /** Starts `item`. Must call `onEnd` exactly once when it finishes (or is skipped). */
  play(item: T, onEnd: () => void): void;
  /** Stops whatever is playing now. After this the pending `onEnd` is ignored. */
  stop(): void;
}

export interface SpeechQueue<T> {
  offer(item: T): void;
  cancel(): void;
  isPlaying(): boolean;
  hasWaiting(): boolean;
}

export interface SpeechQueueDeps<T> {
  player: SpeechPlayer<T>;
  now(): number;
  maxWaitMs?: number;
}

export type SpeechQueueFactory = <T>(deps: SpeechQueueDeps<T>) => SpeechQueue<T>;

export function createSpeechQueue<T>(deps: SpeechQueueDeps<T>): SpeechQueue<T> {
  const maxWait = deps.maxWaitMs ?? MAX_WAIT_MS;
  let playing = false;
  let token = 0;
  let waiting: { item: T; at: number } | undefined;

  function start(item: T): void {
    playing = true;
    const mine = ++token;
    let ended = false;
    const onEnd = (): void => {
      if (ended || mine !== token) return;
      ended = true;
      playing = false;
      promote();
    };
    try {
      deps.player.play(item, onEnd);
    } catch {
      onEnd();
    }
  }

  function promote(): void {
    const w = waiting;
    waiting = undefined;
    if (w === undefined) return;
    if (deps.now() - w.at > maxWait) return;
    start(w.item);
  }

  return {
    offer(item) {
      if (!playing) {
        start(item);
        return;
      }
      waiting = { item, at: deps.now() };
    },
    cancel() {
      waiting = undefined;
      if (!playing) return;
      playing = false;
      token++;
      try {
        deps.player.stop();
      } catch {
        /* ignore */
      }
    },
    isPlaying: () => playing,
    hasWaiting: () => waiting !== undefined,
  };
}
