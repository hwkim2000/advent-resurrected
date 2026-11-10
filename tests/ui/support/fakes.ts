// Test doubles for the pure UI modules: clock, terminal view, motion preference, logger.
// Test support only. No browser globals.

import { newGame, start } from '../../../src/engine/index';
import type { Env } from '../../../src/engine/index';
import { storeAutosave } from '../../../src/ui/autosave';
import { ExtensionHooks } from '../../../src/ui/extension-hooks';
import type { InputGate } from '../../../src/ui/extension-hooks';
import { GameController } from '../../../src/ui/game-controller';
import type { ControllerDeps } from '../../../src/ui/game-controller';
import type {
  InputResolver,
  ResolveContext,
  TranslateOutcome,
} from '../../../src/ui/input-resolver';
import { MemoryKeyValueStore } from '../../../src/ui/kv-store';
import { SETTINGS_KEY } from '../../../src/ui/save-store';
import { printSettings } from '../../../src/ui/settings';
import type { Speed } from '../../../src/ui/types';
import type {
  BlockMeta,
  Clock,
  KeyValueStore,
  Logger,
  Mode,
  MotionPreference,
  PromptInfo,
  TerminalPort,
  TranscriptLine,
} from '../../../src/ui/types';

/** Clock whose time is set by the test. */
export class FakeClock implements Clock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Motion preference whose value is set by the test. */
export class FakeMotion implements MotionPreference {
  constructor(public isReduced = false) {}
  reduced(): boolean {
    return this.isReduced;
  }
}

/** Every call made on a FakeTerminal, in order. */
export type TerminalCall =
  | { method: 'appendInstant'; lines: TranscriptLine[] }
  | { method: 'beginBlock'; block: BlockMeta }
  | { method: 'writeChunk'; blockId: number; chunk: string }
  | { method: 'endBlock'; block: BlockMeta }
  | { method: 'clear' }
  | { method: 'setPrompt'; info: PromptInfo }
  | { method: 'setInputEnabled'; enabled: boolean }
  | { method: 'setBusy'; busy: boolean }
  | { method: 'announce'; text: string }
  | { method: 'showMode'; selected: Mode; game: Mode | undefined }
  | { method: 'trimTo'; maxLines: number }
  | { method: 'showPending' }
  | { method: 'hidePending' }
  | { method: 'announceInterpretation'; command: string };

/** One revealed block, reassembled from its chunks. */
export interface CapturedBlock {
  id: number;
  kind: BlockMeta['kind'];
  text: string;
  /** Concatenation of the chunks actually written. */
  revealed: string;
  ended: boolean;
}

/**
 * TerminalPort that records every call and every chunk. Chunks are kept in
 * `blocks` and `chunks`, which are never trimmed, so they are outside the
 * 2000-line transcript cap.
 */
export class FakeTerminal implements TerminalPort {
  readonly calls: TerminalCall[] = [];
  readonly chunks: { blockId: number; chunk: string }[] = [];
  readonly blocks: CapturedBlock[] = [];
  readonly instantLines: TranscriptLine[] = [];
  readonly announcements: string[] = [];
  readonly interpretations: string[] = [];
  pending = false;
  prompt: PromptInfo | undefined;
  inputEnabled = true;
  busy = false;

  appendInstant(lines: readonly TranscriptLine[]): void {
    const copy = lines.map((l) => ({ ...l }));
    this.calls.push({ method: 'appendInstant', lines: copy });
    this.instantLines.push(...copy);
  }
  beginBlock(block: BlockMeta): void {
    this.calls.push({ method: 'beginBlock', block: { ...block } });
    this.blocks.push({ id: block.id, kind: block.kind, text: block.text, revealed: '', ended: false });
  }
  writeChunk(blockId: number, chunk: string): void {
    this.calls.push({ method: 'writeChunk', blockId, chunk });
    this.chunks.push({ blockId, chunk });
    const b = this.blocks.find((x) => x.id === blockId);
    if (b) b.revealed += chunk;
  }
  endBlock(block: BlockMeta): void {
    this.calls.push({ method: 'endBlock', block: { ...block } });
    const b = this.blocks.find((x) => x.id === block.id);
    if (b) b.ended = true;
  }
  clear(): void {
    this.calls.push({ method: 'clear' });
  }
  setPrompt(info: PromptInfo): void {
    this.calls.push({ method: 'setPrompt', info: { ...info } });
    this.prompt = { ...info };
  }
  setInputEnabled(enabled: boolean): void {
    this.calls.push({ method: 'setInputEnabled', enabled });
    this.inputEnabled = enabled;
  }
  setBusy(busy: boolean): void {
    this.calls.push({ method: 'setBusy', busy });
    this.busy = busy;
  }
  announce(text: string): void {
    this.calls.push({ method: 'announce', text });
    this.announcements.push(text);
  }
  showMode(selected: Mode, game: Mode | undefined): void {
    this.calls.push({ method: 'showMode', selected, game });
  }
  trimTo(maxLines: number): void {
    this.calls.push({ method: 'trimTo', maxLines });
  }
  showPending(): void {
    this.calls.push({ method: 'showPending' });
    this.pending = true;
  }
  hidePending(): void {
    this.calls.push({ method: 'hidePending' });
    this.pending = false;
  }
  announceInterpretation(command: string): void {
    this.calls.push({ method: 'announceInterpretation', command });
    this.interpretations.push(command);
  }

  /** Revealed text of all blocks of the given kind, in order. */
  textOfKind(kind: BlockMeta['kind']): string {
    return this.blocks
      .filter((b) => b.kind === kind)
      .map((b) => b.revealed)
      .join('');
  }
  /** Calls of one method, in order. */
  callsOf<M extends TerminalCall['method']>(method: M): Extract<TerminalCall, { method: M }>[] {
    return this.calls.filter((c): c is Extract<TerminalCall, { method: M }> => c.method === method);
  }
}

/** Logger that records its messages. */
export class RecordingLogger implements Logger {
  readonly entries: { message: string; cause?: unknown }[] = [];
  error(message: string, cause?: unknown): void {
    this.entries.push(cause === undefined ? { message } : { message, cause });
  }
}

/* ---- voice-input additions (origin, gates, failing stores, controller builder) ---- */

/** A ResolveContext copy taken at call time, so later mutation cannot change it. */
export type RecordedContext = Readonly<ResolveContext>;

/**
 * Scriptable InputResolver that records every `ctx` (including `origin`) it is
 * given. By default no line needs translation. Set `needs` and `outcome` to script it.
 */
export class ScriptedResolver implements InputResolver {
  readonly needsCalls: { line: string; ctx: RecordedContext }[] = [];
  readonly translateCalls: { line: string; ctx: RecordedContext }[] = [];
  readonly acceptedLines: string[] = [];
  starts = 0;
  needs: (line: string, ctx: RecordedContext) => boolean = () => false;
  outcome: (line: string, ctx: RecordedContext) => TranslateOutcome | Promise<TranslateOutcome> = (
    line,
  ) => ({ kind: 'translated', command: line });

  needsTranslation(line: string, ctx: ResolveContext): boolean {
    const copy = { ...ctx };
    this.needsCalls.push({ line, ctx: copy });
    return this.needs(line, copy);
  }
  async translate(line: string, ctx: ResolveContext, _signal: AbortSignal): Promise<TranslateOutcome> {
    const copy = { ...ctx };
    this.translateCalls.push({ line, ctx: copy });
    return this.outcome(line, copy);
  }
  startGame(): void {
    this.starts += 1;
  }
  accepted(text: string): void {
    this.acceptedLines.push(text);
  }
  /** Origins seen by `needsTranslation` and `translate`, in call order. */
  get origins(): (ResolveContext['origin'])[] {
    return [...this.needsCalls, ...this.translateCalls].map((c) => c.ctx.origin);
  }
}

/** Key-value store whose operations can be made to throw, with attempt counters. */
export class FailingKeyValueStore implements KeyValueStore {
  readonly inner = new MemoryKeyValueStore();
  failSet: boolean | ((key: string) => boolean) = false;
  failGet: boolean | ((key: string) => boolean) = false;
  failRemove: boolean | ((key: string) => boolean) = false;
  setAttempts = 0;
  failedSets = 0;

  private static hit(rule: boolean | ((key: string) => boolean), key: string): boolean {
    return typeof rule === 'function' ? rule(key) : rule;
  }
  get(key: string): string | null {
    if (FailingKeyValueStore.hit(this.failGet, key)) throw new Error('kv get failed');
    return this.inner.get(key);
  }
  set(key: string, value: string): void {
    this.setAttempts += 1;
    if (FailingKeyValueStore.hit(this.failSet, key)) {
      this.failedSets += 1;
      throw new Error('kv set failed');
    }
    this.inner.set(key, value);
  }
  remove(key: string): void {
    if (FailingKeyValueStore.hit(this.failRemove, key)) throw new Error('kv remove failed');
    this.inner.remove(key);
  }
}

export interface MakeControllerOptions {
  /** Selected mode, which also decides the game mode of a fresh game. Default 'haunted'. */
  mode?: Mode;
  /** Fresh-game seed (the clock's start value). Default 1. */
  seed?: number;
  /** Gates registered, in order, before the boot. */
  gates?: readonly InputGate[];
  /** Deflection_Count the game starts with, restored from a stored autosave. Default 0. */
  deflections?: number;
  /** Store to use (a FailingKeyValueStore, say). Default: a new MemoryKeyValueStore. */
  kv?: KeyValueStore;
  /** Resolver installed with `setInputResolver`. */
  resolver?: InputResolver;
  /** Teletype speed. Default 'instant'. */
  speed?: Speed;
  /** Run the boot so the phase is 'ready'. Default true. */
  boot?: boolean;
  onGameStart?: ControllerDeps['onGameStart'];
}

export interface MadeController {
  controller: GameController;
  view: FakeTerminal;
  clock: FakeClock;
  log: RecordingLogger;
  hooks: ExtensionHooks;
  kv: KeyValueStore;
  /** Disposers of the registered gates, in order. */
  disposeGates: (() => void)[];
}

const NO_STORAGE_ENV: Env = { storage: { read: () => undefined, write: () => true } };

/**
 * Builds a GameController with fakes and optionally gates, a starting
 * Deflection_Count (stored as an autosave `ui` field, so the controller restores
 * it), a seed and a resolver. Settings are written to the store only when it
 * accepts writes; a failing store is switched on by the caller after this returns.
 */
export function makeController(opts: MakeControllerOptions = {}): MadeController {
  const mode = opts.mode ?? 'haunted';
  const seed = opts.seed ?? 1;
  const kv = opts.kv ?? new MemoryKeyValueStore();
  const clock = new FakeClock(seed);
  const log = new RecordingLogger();
  const view = new FakeTerminal();
  const hooks = new ExtensionHooks(log);
  try {
    kv.set(SETTINGS_KEY, printSettings({ mode, speed: opts.speed ?? 'instant', crt: true }));
  } catch {
    /* a store that fails from the start simply has no stored settings */
  }
  const deflections = opts.deflections ?? 0;
  if (deflections > 0) {
    const state = start(newGame(seed, { oldstyle: mode === '1976' }), NO_STORAGE_ENV).state;
    storeAutosave(
      kv,
      state,
      { kind: 'command', text: '' },
      [],
      undefined,
      deflections,
    );
  }
  const disposeGates = (opts.gates ?? []).map((g) => hooks.addInputGate(g));
  const controller = new GameController({
    kv,
    clock,
    motion: new FakeMotion(false),
    view,
    hooks,
    log,
    ...(opts.onGameStart ? { onGameStart: opts.onGameStart } : {}),
  });
  if (opts.resolver) controller.setInputResolver(opts.resolver);
  if (opts.boot !== false) {
    controller.startBoot();
    controller.tick(0);
    controller.skip();
  }
  return { controller, view, clock, log, hooks, kv, disposeGates };
}
