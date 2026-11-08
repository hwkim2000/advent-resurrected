// Typed extension registry for later specs (voice, AI, narrator, haunting).
// Pure: no browser globals. Gated on Game_Mode inside the registry itself.

import type { OutputEvent } from '../engine/index';
import type { LineKind, Logger, Mode, PromptKind } from './types';

export interface HookContext {
  readonly gameMode: Mode;
  readonly selectedMode: Mode;
  readonly prompt: PromptKind;
}

export interface OutputBlock {
  readonly text: string;
  readonly kind: LineKind;
}

export type InputTransformer = (line: string, ctx: HookContext) => string;
export type EventObserver = (events: readonly OutputEvent[], ctx: HookContext) => void;
export type NarratorLineProvider = (
  events: readonly OutputEvent[],
  ctx: HookContext,
) => readonly string[];
export type OutputListener = (block: OutputBlock, ctx: HookContext) => void;

export class ExtensionHooks {
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

  observeEvents(events: readonly OutputEvent[], ctx: HookContext): void {
    if (ctx.gameMode !== 'haunted') return;
    const frozen = Object.freeze({ ...ctx });
    for (const fn of [...this.observers]) {
      try {
        fn(events, frozen);
      } catch (e) {
        this.log.error('event observer threw', e);
      }
    }
  }

  narratorLines(events: readonly OutputEvent[], ctx: HookContext): string[] {
    if (ctx.gameMode !== 'haunted') return [];
    const frozen = Object.freeze({ ...ctx });
    const result: string[] = [];
    for (const fn of [...this.providers]) {
      try {
        const out: unknown = fn(events, frozen);
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
