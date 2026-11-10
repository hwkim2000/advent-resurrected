// Typed extension registry for later specs (voice, AI, narrator, haunting).
// Pure: no browser globals. Gated on Game_Mode inside the registry itself.

import type { GameState, OutputEvent } from '../engine/index';
import type { InputOrigin, LineKind, Logger, Mode, PromptKind } from './types';

export interface HookContext {
  readonly gameMode: Mode;
  readonly selectedMode: Mode;
  readonly prompt: PromptKind;
}

export interface OutputBlock {
  readonly text: string;
  readonly kind: LineKind;
}

/** What happened in one engine call; handed to providers and observers. */
export interface TurnInfo {
  /** State before the call; undefined on the first present() of a game. */
  readonly before: GameState | undefined;
  readonly after: GameState;
  /** Text given to the engine (after input transformers); '' at game start. */
  readonly line: string;
  readonly origin: InputOrigin;
}

export type InputTransformer = (line: string, ctx: HookContext) => string;
export type EventObserver = (
  events: readonly OutputEvent[],
  ctx: HookContext,
  turn: TurnInfo,
) => void;
export type NarratorLineProvider = (
  events: readonly OutputEvent[],
  ctx: HookContext,
  turn: TurnInfo,
) => readonly string[];
export type OutputListener = (block: OutputBlock, ctx: HookContext) => void;

export type GateResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deflect'; readonly lines: readonly string[]; readonly count?: false }; // 1 to 3 non-empty strings

export type InputGate = (
  text: string,
  origin: InputOrigin,
  deflections: number,
  ctx: HookContext,
) => GateResult;

const ALLOW: GateResult = Object.freeze({ kind: 'allow' });

/** Returns a fresh frozen deflect copy if `out` is a valid deflect, else undefined. */
function validDeflect(out: unknown): GateResult | undefined {
  if (typeof out !== 'object' || out === null) return undefined;
  const r = out as { kind?: unknown; lines?: unknown; count?: unknown };
  if (r.kind !== 'deflect' || !Array.isArray(r.lines)) return undefined;
  const lines: unknown[] = r.lines;
  if (lines.length < 1 || lines.length > 3) return undefined;
  if (!lines.every((s) => typeof s === 'string' && s.length > 0)) return undefined;
  const frozenLines = Object.freeze([...(lines as string[])]);
  if (r.count === false) {
    return Object.freeze({ kind: 'deflect' as const, lines: frozenLines, count: false as const });
  }
  return Object.freeze({ kind: 'deflect' as const, lines: frozenLines });
}

function isAllow(out: unknown): boolean {
  return typeof out === 'object' && out !== null && (out as { kind?: unknown }).kind === 'allow';
}

export class ExtensionHooks {
  private readonly gates: { readonly fn: InputGate }[] = [];

  private readonly transformers: InputTransformer[] = [];
  private readonly observers: EventObserver[] = [];
  private readonly providers: NarratorLineProvider[] = [];
  private readonly listeners: OutputListener[] = [];

  constructor(private readonly log: Logger) {}

  addInputTransformer(fn: InputTransformer): () => void {
    return this.add(this.transformers, fn);
  }

  addEventObserver(fn: EventObserver): () => void {
    return this.add(this.observers, fn);
  }

  addNarratorLineProvider(fn: NarratorLineProvider): () => void {
    return this.add(this.providers, fn);
  }

  addOutputListener(fn: OutputListener): () => void {
    return this.add(this.listeners, fn);
  }

  addInputGate(fn: InputGate): () => void {
    const entry = { fn };
    this.gates.push(entry);
    return () => {
      const i = this.gates.indexOf(entry);
      if (i >= 0) this.gates.splice(i, 1);
    };
  }

  gateInput(
    text: string,
    origin: InputOrigin,
    deflections: number,
    ctx: HookContext,
  ): GateResult {
    if (ctx.gameMode !== 'haunted') return ALLOW;
    const frozen = Object.freeze({ ...ctx });
    for (const entry of [...this.gates]) {
      try {
        const out: unknown = entry.fn(text, origin, deflections, frozen);
        const deflect = validDeflect(out);
        if (deflect) return deflect;
        if (!isAllow(out)) this.log.error('input gate returned an invalid value', out);
      } catch (e) {
        this.log.error('input gate threw', e);
      }
    }
    return ALLOW;
  }

  transformInput(line: string, ctx: HookContext): string {
    if (ctx.gameMode !== 'haunted') return line;
    const frozen = Object.freeze({ ...ctx });
    let current = line;
    for (const fn of [...this.transformers]) {
      try {
        const out: unknown = fn(current, frozen);
        if (typeof out === 'string') current = out;
        else this.log.error('input transformer returned a non-string value', out);
      } catch (e) {
        this.log.error('input transformer threw', e);
      }
    }
    return current;
  }

  observeEvents(events: readonly OutputEvent[], ctx: HookContext, turn: TurnInfo): void {
    if (ctx.gameMode !== 'haunted') return;
    const frozen = Object.freeze({ ...ctx });
    for (const fn of [...this.observers]) {
      try {
        fn(events, frozen, turn);
      } catch (e) {
        this.log.error('event observer threw', e);
      }
    }
  }

  narratorLines(events: readonly OutputEvent[], ctx: HookContext, turn: TurnInfo): string[] {
    if (ctx.gameMode !== 'haunted') return [];
    const frozen = Object.freeze({ ...ctx });
    const result: string[] = [];
    for (const fn of [...this.providers]) {
      try {
        const out: unknown = fn(events, frozen, turn);
        if (Array.isArray(out) && out.every((s) => typeof s === 'string')) {
          result.push(...(out as string[]));
        } else {
          this.log.error('narrator line provider returned an invalid value', out);
        }
      } catch (e) {
        this.log.error('narrator line provider threw', e);
      }
    }
    return result;
  }

  notifyOutput(block: OutputBlock, ctx: HookContext): void {
    if (ctx.gameMode !== 'haunted') return;
    const frozen = Object.freeze({ ...ctx });
    const copy = Object.freeze({ text: block.text, kind: block.kind });
    for (const fn of [...this.listeners]) {
      try {
        fn(copy, frozen);
      } catch (e) {
        this.log.error('output listener threw', e);
      }
    }
  }

  private add<T>(list: T[], fn: T): () => void {
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
}
