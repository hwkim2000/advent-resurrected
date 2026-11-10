import { describe, it, expect } from 'vitest';
import { newGame, serialize, start } from '../../src/engine/index';
import type { Env } from '../../src/engine/index';
import {
  DEFLECTION_LIMIT,
  decodeAutosave,
  encodeAutosave,
  storeAutosave,
} from '../../src/ui/autosave';
import { AUTOSAVE_KEY } from '../../src/ui/save-store';
import type { KeyValueStore, PromptInfo, TranscriptLine } from '../../src/ui/types';

const env: Env = { storage: { read: () => undefined, write: () => true } };
const state = start(newGame(7), env).state;
const prompt: PromptInfo = { kind: 'command', text: '' };
const lines: TranscriptLine[] = [{ kind: 'original', text: 'Hello.', eol: true }];

function withUi(ui: unknown): string {
  return JSON.stringify({ v: 1, state: serialize(state), prompt, lines, ui });
}

describe('autosave ui field', () => {
  it('is byte-identical to the pre-feature encoding when deflections is 0', () => {
    const legacy = JSON.stringify({ v: 1, state: serialize(state), prompt, lines });
    expect(encodeAutosave(state, prompt, lines)).toBe(legacy);
    expect(encodeAutosave(state, prompt, lines, undefined, 0)).toBe(legacy);
  });

  it('appends ui as the last key when deflections > 0 and round-trips', () => {
    const json = encodeAutosave(state, prompt, lines, undefined, 1)!;
    expect(Object.keys(JSON.parse(json)).at(-1)).toBe('ui');
    expect(JSON.parse(json).ui).toEqual({ deflections: 1 });
    expect(decodeAutosave(json)!.deflections).toBe(1);
  });

  it('keeps ui while dropping old lines to fit', () => {
    const many: TranscriptLine[] = Array.from({ length: 50 }, (_, i) => ({
      kind: 'original',
      text: 'line ' + i,
      eol: true,
    }));
    const full = encodeAutosave(state, prompt, many, undefined, 1)!;
    const json = encodeAutosave(state, prompt, many, full.length - 200, 1)!;
    expect(json.length).toBeLessThanOrEqual(full.length - 200);
    expect(decodeAutosave(json)!.deflections).toBe(1);
  });

  it('decodes older autosaves and bad ui values as 0 without rejecting', () => {
    expect(decodeAutosave(encodeAutosave(state, prompt, lines)!)!.deflections).toBe(0);
    for (const ui of [undefined, null, 5, 'x', [], {}, { deflections: -1 }, { deflections: 1.5 },
      { deflections: DEFLECTION_LIMIT + 1 }, { deflections: '1' }, { deflections: null }]) {
      const r = decodeAutosave(withUi(ui));
      expect(r).toBeDefined();
      expect(r!.deflections).toBe(0);
    }
  });

  it('ignores unknown ui keys', () => {
    expect(decodeAutosave(withUi({ deflections: 1, extra: true }))!.deflections).toBe(1);
  });

  it('storeAutosave passes deflections through', () => {
    let saved: string | null = null;
    const kv: KeyValueStore = {
      get: () => saved,
      set: (k, v) => {
        expect(k).toBe(AUTOSAVE_KEY);
        saved = v;
      },
      remove: () => {
        saved = null;
      },
    } as KeyValueStore;
    storeAutosave(kv, state, prompt, lines, undefined, 1);
    expect(decodeAutosave(saved)!.deflections).toBe(1);
  });
});
