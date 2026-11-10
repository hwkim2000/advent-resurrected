// GameController: ties the pure UI modules to the engine. It owns the phase,
// engine state, transcript, history, autosave and hooks, and talks to the
// screen only through the TerminalPort. Pure and DOM-free: time comes from
// `tick(nowMs)` and the injected Clock, storage from the injected KeyValueStore.

import { newGame, start, step } from '../engine/index';
import type { Env, GameState, OutputEvent } from '../engine/index';
import {
  AUTOSAVE_LINE_KINDS,
  AUTOSAVE_MAX_LINES,
  DEFLECTION_LIMIT,
  clearAutosave,
  loadAutosave,
  storeAutosave,
} from './autosave';
import { BOOT_CPS, selectBoot } from './boot-script';
import { lastPromptOf, originalTextOf, splitIntoLines } from './event-render';
import type { ExtensionHooks, HookContext } from './extension-hooks';
import type { GamePhase, InputResolver, ResolveContext, TranslateOutcome } from './input-resolver';
import {
  emptyHistory,
  parseHistory,
  printHistory,
  pushLine,
  recallDown,
  recallUp,
} from './history';
import type { HistoryState } from './history';
import { HISTORY_KEY, SETTINGS_KEY, SaveStore } from './save-store';
import { parseSettings, printSettings } from './settings';
import type { Settings } from './settings';
import { Teletype } from './teletype';
import { MAX_TRANSCRIPT_LINES, Transcript } from './transcript';
import type {
  Clock,
  InputOrigin,
  KeyValueStore,
  LineKind,
  Logger,
  Mode,
  MotionPreference,
  PromptInfo,
  PromptKind,
  Speed,
  TerminalPort,
} from './types';

export type Phase = GamePhase;

export interface ControllerDeps {
  /** ResilientStore in production. */
  kv: KeyValueStore;
  clock: Clock;
  motion: MotionPreference;
  view: TerminalPort;
  hooks: ExtensionHooks;
  log: Logger;
  /** New game confirmation; defaults to always yes. */
  confirm?: (message: string) => boolean;
  /** Informational: called after the degraded-storage notice has been shown. */
  onDegradedStorage?: () => void;
  /**
   * Called whenever a game becomes active (boot-time new game, autosave restore,
   * New Game) with the running game's mode (the restored game's own mode on restore).
   */
  onGameStart?: (gameMode: Mode) => void;
}

export const NOTICE_ENGINE_ERROR = '?SYSTEM ERROR - COMMAND IGNORED';
export const NOTICE_RESUMING = 'RESUMING SAVED SESSION';
export const NOTICE_STORAGE_DEGRADED = 'SAVES WILL NOT SURVIVE A RELOAD';
export const NOTICE_MODE_CHANGE = 'MODE CHANGE TAKES EFFECT ON THE NEXT NEW GAME';
export const NOTICE_GAME_OVER = 'GAME OVER. PRESS ENTER OR CHOOSE NEW GAME TO PLAY AGAIN.';
export const NOTICE_SAVED = 'SESSION SAVED. START A NEW GAME, THEN USE RESUME TO LOAD IT.';
export const NOTICE_FAILED = '?SYSTEM ERROR - RELOAD THE PAGE';
export const CONFIRM_NEW_GAME = 'START A NEW GAME? THE CURRENT GAME WILL BE LOST.';
export const NOTICE_AI_OFFLINE = 'THE SPIRITS ARE NOT ANSWERING. CLASSIC PARSER IN USE.';
export const PENDING_INDICATOR_MS = 400;
export const RESOLUTION_WATCHDOG_MS = 10_000;

interface Resolution {
  token: number;
  line: string;
  origin: InputOrigin;
  stateAtStart: GameState;
  abort: AbortController;
  startedAtTick: number | undefined;
  pendingShown: boolean;
}

interface QueueEntry {
  readonly line: string;
  readonly origin: InputOrigin;
}

const MAX_LINE_CHARS = 1023;
const DEFAULT_PROMPT: PromptInfo = { kind: 'command', text: '' };

export class GameController {
  private readonly deps: ControllerDeps;
  private readonly kv: KeyValueStore;
  private readonly env: Env;
  private readonly teletype: Teletype;
  private readonly transcript = new Transcript();
  private current: Settings;
  private hist: HistoryState;
  private state: GameState | undefined;
  private prompt: PromptInfo = DEFAULT_PROMPT;
  private phaseValue: Phase = 'booting';
  private readonly queue: QueueEntry[] = [];
  private deflections = 0;
  private working = false;
  private bootStarted = false;
  private bootQueued = false;
  private lastNow = 0;
  private lastBusy = false;
  private storageNoticeShown = false;
  private resolver: InputResolver | undefined;
  private resolving: Resolution | undefined;
  private nextToken = 0;

  readonly history: {
    up(typed: string): string;
    down(typed: string): string;
    reset(): void;
  };

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.kv = deps.kv;
    this.env = { storage: new SaveStore(deps.kv) };
    this.current = parseSettings(this.safeGet(SETTINGS_KEY));
    this.hist = emptyHistory(parseHistory(this.safeGet(HISTORY_KEY)));
    this.teletype = new Teletype({
      speed: () => this.current.speed,
      reduced: () => deps.motion.reduced(),
      sink: {
        begin: (b) => deps.view.beginBlock(b),
        write: (id, chunk) => deps.view.writeChunk(id, chunk),
        end: (b) => deps.view.endBlock(b),
      },
      onRevealed: (b) => {
        if (b.kind === 'boot') return;
        if (b.kind === 'translation') {
          deps.view.announceInterpretation(b.text.trim());
          return;
        }
        deps.hooks.notifyOutput({ text: b.text, kind: b.kind }, this.ctx());
        deps.view.announce(b.text);
      },
      onIdle: () => this.idleCheck(),
    });
    this.history = {
      up: (typed) => {
        const r = recallUp(this.hist, typed);
        this.hist = r.h;
        return r.text;
      },
      down: (typed) => {
        const r = recallDown(this.hist, typed);
        this.hist = r.h;
        return r.text;
      },
      reset: () => {
        this.hist = { entries: this.hist.entries, pos: null, draft: '' };
      },
    };
    deps.view.setInputEnabled(true);
    deps.view.showMode(this.current.mode, undefined);
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  get settings(): Settings {
    return { ...this.current };
  }

  /** Game_Mode of the running game, from the engine's oldstyle option. */
  get gameMode(): Mode | undefined {
    if (this.state === undefined) return undefined;
    return this.state.session.settings.oldstyle ? '1976' : 'haunted';
  }

  /** Kind of the current prompt; undefined when no game is running. */
  get promptKind(): PromptKind | undefined {
    if (this.state === undefined) return undefined;
    return this.prompt.kind;
  }

  /** Read-only snapshot for tests and later specs. */
  get engineState(): GameState | undefined {
    return this.state;
  }

  // ---- public API --------------------------------------------------------

  /** Chooses the Short or Full boot and enqueues it; the game begins when it ends. */
  startBoot(): void {
    if (this.bootStarted || this.phaseValue !== 'booting') return;
    this.bootStarted = true;
    const script = selectBoot(loadAutosave(this.kv) !== undefined);
    this.run(() => {
      for (const line of script) {
        const text = line.text + '\n';
        this.transcript.append(splitIntoLines(text, 'boot'));
        this.teletype.enqueue(
          {
            kind: 'boot',
            text,
            cps: BOOT_CPS,
            ...(line.pauseAfterMs > 0 ? { pauseAfterMs: line.pauseAfterMs } : {}),
          },
          this.lastNow,
        );
      }
      this.deps.view.trimTo(MAX_TRANSCRIPT_LINES);
      this.bootQueued = true;
    });
  }

  /** Reveals everything pending at once; during the boot this begins the game. */
  skip(): void {
    this.run(() => this.teletype.flush());
  }

  /** Installs (or removes) the asynchronous input resolver; the AI parser in Haunted mode. */
  setInputResolver(r: InputResolver | undefined): void {
    this.resolver = r;
  }

  tick(nowMs: number): void {
    this.lastNow = nowMs;
    this.teletype.tick(nowMs);
    this.tickResolution(nowMs);
  }

  private tickResolution(nowMs: number): void {
    const r = this.resolving;
    if (r === undefined) return;
    if (r.startedAtTick === undefined) {
      r.startedAtTick = nowMs;
      return;
    }
    const elapsed = nowMs - r.startedAtTick;
    if (elapsed >= RESOLUTION_WATCHDOG_MS) {
      this.deps.log.error('input resolution timed out', undefined);
      this.run(() => {
        if (this.resolving !== r) return;
        this.finishResolution(r);
        r.abort.abort();
        this.deliver(r.line, r.line, r.origin);
      });
      return;
    }
    if (elapsed >= PENDING_INDICATOR_MS && !r.pendingShown) {
      r.pendingShown = true;
      this.deps.view.showPending();
    }
  }

  /** One submitted line; queued while the boot or earlier output is pending. */
  submit(raw: string, origin: InputOrigin = 'typed'): void {
    if (this.phaseValue === 'failed') return;
    const line = raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) : raw;
    const kind: InputOrigin = origin === 'spoken' ? 'spoken' : 'typed';
    if (
      this.working ||
      this.resolving !== undefined ||
      this.phaseValue === 'booting' ||
      this.teletype.busy ||
      this.queue.length > 0
    ) {
      this.queue.push({ line, origin: kind });
      return;
    }
    this.run(() => this.processLine(line, kind));
  }

  requestNewGame(): void {
    if (this.phaseValue === 'booting' || this.phaseValue === 'failed') return;
    if (this.phaseValue === 'ready') {
      const ok = (this.deps.confirm ?? (() => true))(CONFIRM_NEW_GAME);
      if (!ok) return;
    }
    this.run(() => this.startFresh());
  }

  setMode(mode: Mode): void {
    this.current = { ...this.current, mode };
    this.persistSettings();
    this.run(() => {
      this.notice(NOTICE_MODE_CHANGE);
      this.deps.view.showMode(mode, this.gameMode);
    });
  }

  setSpeed(speed: Speed): void {
    this.current = { ...this.current, speed };
    this.persistSettings();
  }

  setCrt(on: boolean): void {
    this.current = { ...this.current, crt: on };
    this.persistSettings();
  }

  /** Called by the storage layer when it falls back to memory; shows the notice once. */
  notifyStorageDegraded(): void {
    if (this.storageNoticeShown) return;
    this.storageNoticeShown = true;
    this.run(() => this.notice(NOTICE_STORAGE_DEGRADED));
    this.deps.onDegradedStorage?.();
  }

  // ---- scheduling --------------------------------------------------------

  /** Runs `fn` as one unit of work, then lets queued work proceed. */
  private run(fn: () => void): void {
    if (this.working) {
      fn();
      return;
    }
    this.exec(fn);
    this.idleCheck();
  }

  private exec(fn: () => void): void {
    this.working = true;
    try {
      fn();
    } finally {
      this.working = false;
    }
  }

  /** Starts the game once the boot is revealed, then delivers queued lines in order. */
  private idleCheck(): void {
    while (!this.working && !this.teletype.busy && this.resolving === undefined) {
      if (this.phaseValue === 'booting') {
        if (!this.bootQueued) break;
        this.bootQueued = false;
        this.exec(() => this.beginGame());
        continue;
      }
      if (this.phaseValue === 'failed') {
        this.queue.length = 0;
        break;
      }
      const entry = this.queue.shift();
      if (entry === undefined) break;
      this.exec(() => this.processLine(entry.line, entry.origin));
    }
    this.syncBusy();
  }

  private syncBusy(): void {
    const busy = this.teletype.busy;
    if (busy !== this.lastBusy) {
      this.lastBusy = busy;
      this.deps.view.setBusy(busy);
    }
  }

  private setPhase(phase: Phase): void {
    this.phaseValue = phase;
    // The input stays enabled (and focused) during the boot so typeahead is kept
    // and queued; only a failed start disables it.
    this.deps.view.setInputEnabled(phase !== 'failed');
  }

  // ---- game flow ---------------------------------------------------------

  private beginGame(): void {
    const restored = loadAutosave(this.kv);
    if (restored !== undefined) {
      this.state = restored.state;
      this.prompt = restored.prompt;
      this.transcript.append(restored.lines);
      this.deps.view.appendInstant(restored.lines);
      this.deps.view.trimTo(MAX_TRANSCRIPT_LINES);
      this.deflections = restored.deflections;
      this.setPhase('ready');
      this.notice(NOTICE_RESUMING);
      this.deps.view.setPrompt(this.prompt);
      this.deps.view.showMode(this.current.mode, this.gameMode);
      this.announceGameStart();
      this.safeVoid(() => this.resolver?.startGame());
      return;
    }
    this.newGameStart();
    this.announceGameStart();
    this.safeVoid(() => this.resolver?.startGame());
  }

  /** Tells the host which mode the now-running game has; no-op if no game is running. */
  private announceGameStart(): void {
    const mode = this.gameMode;
    if (mode === undefined) return;
    try {
      this.deps.onGameStart?.(mode);
    } catch (e) {
      this.deps.log.error('game start hook failed', e);
    }
  }

  private newGameStart(): void {
    this.deflections = 0;
    const seed = this.deps.clock.now() | 0;
    try {
      const fresh = newGame(seed, { oldstyle: this.current.mode === '1976' });
      const result = start(fresh, this.env);
      this.state = result.state;
      this.prompt = DEFAULT_PROMPT;
      this.setPhase('ready');
      this.deps.view.showMode(this.current.mode, this.gameMode);
      this.present(result.events);
    } catch (e) {
      this.deps.log.error('engine start failed', e);
      this.state = undefined;
      this.setPhase('failed');
      this.notice(NOTICE_FAILED);
    }
  }

  private startFresh(): void {
    const pending = this.resolving;
    if (pending !== undefined) {
      this.finishResolution(pending);
      pending.abort.abort();
    }
    this.teletype.flush();
    this.queue.length = 0;
    clearAutosave(this.kv);
    this.transcript.clear();
    this.deps.view.clear();
    this.state = undefined;
    this.hist = { entries: this.hist.entries, pos: null, draft: '' };
    this.newGameStart();
    this.announceGameStart();
    this.safeVoid(() => this.resolver?.startGame());
  }

  private safeVoid(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.deps.log.error('input resolver failed', e);
    }
  }

  private processLine(line: string, origin: InputOrigin): void {
    const prev = this.hist;
    const pushed = pushLine(prev, line);
    if (origin === 'spoken') {
      // Spoken lines enter the history but leave the browsing position and draft alone.
      const stored = pushed.entries !== prev.entries;
      const dropped = Math.max(0, prev.entries.length + (stored ? 1 : 0) - pushed.entries.length);
      this.hist = {
        entries: pushed.entries,
        pos: prev.pos === null ? null : Math.max(0, prev.pos - dropped),
        draft: prev.draft,
      };
    } else {
      this.hist = pushed;
    }
    this.persistHistory();

    if (this.phaseValue === 'over') {
      const word = line.trim().toUpperCase();
      if (word === '' || word === 'NEW') {
        this.startFresh();
      } else {
        this.echo(line);
        this.notice(this.overNotice());
      }
      return;
    }

    const before = this.state;
    if (before === undefined) return;
    this.echo(line);

    const resolver = this.resolver;
    if (resolver !== undefined) {
      const ctx = this.resolveContext(origin);
      if (
        ctx.gameMode === 'haunted' &&
        ctx.promptKind === 'command' &&
        ctx.phase === 'ready' &&
        this.guarded(() => resolver.needsTranslation(line, ctx), false)
      ) {
        this.beginResolution(resolver, line, before, ctx, origin);
        return;
      }
    }
    this.deliver(line, line, origin);
  }

  private guarded<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (e) {
      this.deps.log.error('input resolver failed', e);
      return fallback;
    }
  }

  private resolveContext(origin: InputOrigin): ResolveContext {
    return {
      origin,
      gameMode: this.gameMode,
      promptKind: this.prompt.kind,
      phase: this.phaseValue,
      state: this.state,
    };
  }

  private beginResolution(
    resolver: InputResolver,
    line: string,
    stateAtStart: GameState,
    ctx: ResolveContext,
    origin: InputOrigin,
  ): void {
    const r: Resolution = {
      token: ++this.nextToken,
      line,
      origin,
      stateAtStart,
      abort: new AbortController(),
      startedAtTick: undefined,
      pendingShown: false,
    };
    this.resolving = r;
    let promise: Promise<TranslateOutcome>;
    try {
      promise = resolver.translate(line, ctx, r.abort.signal);
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then(
      (outcome) => this.onResolved(r.token, outcome),
      (e: unknown) => this.onResolveFailed(r.token, e),
    );
  }

  private finishResolution(r: Resolution): void {
    if (this.resolving !== r) return;
    this.resolving = undefined;
    if (r.pendingShown) this.deps.view.hidePending();
  }

  private onResolved(token: number, outcome: TranslateOutcome): void {
    const r = this.resolving;
    if (r === undefined || r.token !== token) return;
    this.run(() => {
      this.finishResolution(r);
      if (this.phaseValue === 'failed') return;
      if (this.prompt.kind !== 'command' || this.state !== r.stateAtStart) {
        this.deliver(r.line, r.line, r.origin);
        return;
      }
      if (outcome.kind === 'translated') {
        this.emit('translation', outcome.command + '\n');
        this.deliver(r.line, outcome.command, r.origin);
        return;
      }
      if (outcome.notice) this.notice(NOTICE_AI_OFFLINE);
      this.deliver(r.line, r.line, r.origin);
    });
  }

  private onResolveFailed(token: number, e: unknown): void {
    const r = this.resolving;
    if (r === undefined || r.token !== token) return;
    this.deps.log.error('input resolution failed', e);
    this.run(() => {
      this.finishResolution(r);
      if (this.phaseValue === 'failed') return;
      this.deliver(r.line, r.line, r.origin);
    });
  }

  /** Gives `text` to the engine for the already echoed `line`. */
  private deliver(_line: string, text: string, origin: InputOrigin): void {
    const before = this.state;
    if (before === undefined) return;
    const wasCommand = this.prompt.kind === 'command';
    const transformed = this.deps.hooks.transformInput(text, this.ctx());
    const gate = this.deps.hooks.gateInput(transformed, origin, this.deflections, this.ctx());
    if (gate.kind === 'deflect') {
      this.applyDeflection(gate.lines);
      return;
    }
    let result;
    try {
      result = step(before, transformed, this.env);
    } catch (e) {
      this.deps.log.error('engine step failed', e);
      this.notice(NOTICE_ENGINE_ERROR);
      return;
    }
    this.state = result.state;
    this.present(result.events);
    if (wasCommand && this.resolver !== undefined) {
      const resolver = this.resolver;
      this.safeVoid(() => resolver.accepted(text));
    }
  }

  /** Shows the outcome of one engine call; the Original_Text always comes first. */
  private present(events: readonly OutputEvent[]): void {
    const state = this.state;
    if (state === undefined) return;

    const text = originalTextOf(events);
    if (text !== '') this.emit('original', text);

    const prompt = lastPromptOf(events);
    if (prompt !== undefined) this.prompt = prompt;

    const over = state.session.status === 'over' || events.some((e) => e.type === 'game-over');
    if (over) {
      this.setPhase('over');
      this.notice(this.overNotice());
    }

    const copy = Object.freeze([...events]);
    const ctx = this.ctx();
    this.deps.hooks.observeEvents(copy, ctx);
    for (const line of this.deps.hooks.narratorLines(copy, ctx)) {
      this.emit('narrator', line + '\n');
    }

    if (!over) this.deps.view.setPrompt(this.prompt);

    if (over) {
      clearAutosave(this.kv);
    } else {
      this.persistAutosave();
    }
  }

  private persistAutosave(): void {
    const state = this.state;
    if (state === undefined) return;
    storeAutosave(
      this.kv,
      state,
      this.prompt,
      this.transcript.tail(AUTOSAVE_MAX_LINES, AUTOSAVE_LINE_KINDS),
      undefined,
      this.deflections,
    );
  }

  /** A gate refused the line: narrate it, count it, keep the engine untouched. */
  private applyDeflection(lines: readonly string[]): void {
    this.deflections = Math.min(DEFLECTION_LIMIT, this.deflections + 1);
    for (const line of lines) this.emit('narrator', line + '\n');
    this.persistAutosave();
  }

  private overNotice(): string {
    return this.state?.session.exitReason === 'suspended' ? NOTICE_SAVED : NOTICE_GAME_OVER;
  }

  // ---- output helpers ----------------------------------------------------

  private ctx(): HookContext {
    return {
      gameMode: this.gameMode ?? this.current.mode,
      selectedMode: this.current.mode,
      prompt: this.prompt.kind,
    };
  }

  /** Input echo: prompt text plus the raw line, shown at once. */
  private echo(line: string): void {
    const echoed = [{ kind: 'input' as const, text: this.prompt.text + line, eol: true }];
    this.transcript.append(echoed);
    this.deps.view.appendInstant(echoed);
    this.deps.view.trimTo(MAX_TRANSCRIPT_LINES);
  }

  private notice(message: string): void {
    this.emit('notice', message + '\n');
  }

  /** Records the text in the transcript and queues it for the Teletype. */
  private emit(kind: LineKind, text: string): void {
    this.transcript.append(splitIntoLines(text, kind));
    this.teletype.enqueue({ kind, text }, this.lastNow);
    this.deps.view.trimTo(MAX_TRANSCRIPT_LINES);
    this.syncBusy();
  }

  // ---- storage helpers ---------------------------------------------------

  private safeGet(key: string): string | null {
    try {
      return this.kv.get(key);
    } catch {
      return null;
    }
  }

  private safeSet(key: string, value: string): void {
    try {
      this.kv.set(key, value);
    } catch {
      /* ResilientStore normally prevents this */
    }
  }

  private persistSettings(): void {
    this.safeSet(SETTINGS_KEY, printSettings(this.current));
  }

  private persistHistory(): void {
    this.safeSet(HISTORY_KEY, printHistory(this.hist.entries));
  }
}
