// Task 5.7: autosave `ui` field example tests (Requirements 13.11, 13.12, 18.14).
// Complements tests/ui/autosave-ui-field.test.ts without duplicating its cases.
import { describe, it, expect } from 'vitest';
import { newGame, serialize, start } from '../../src/engine/index';
import type { Env } from '../../src/engine/index';
import { decodeAutosave, encodeAutosave } from '../../src/ui/autosave';
import type { PromptInfo, TranscriptLine } from '../../src/ui/types';

const env: Env = { storage: { read: () => undefined, write: () => true } };
const state = start(newGame(11), env).state;
const prompt: PromptInfo = { kind: 'yesno', text: 'Really?' };
const lines: TranscriptLine[] = [
  { kind: 'original', text: 'Welcome.', eol: true },
  { kind: 'input', text: 'look', eol: true },
];

/** A stored pre-feature record: fixed key order, no `ui` key. */
function storedPreFeature(): string {
  return (
    '{"v":1,"state":' + JSON.stringify(serialize(state)) +
    ',"prompt":{"kind":"yesno","text":"Really?"}' +
    ',"lines":[{"kind":"original","text":"Welcome.","eol":true},' +
    '{"kind":"input","text":"look","eol":true}]}'
  );
}

describe('autosave ui field examples', () => {
  it('encodes count 0 byte-identical to a stored pre-feature string, with no ui key', () => {
    const json = encodeAutosave(state, prompt, lines, undefined, 0)!;
    expect(json).toBe(storedPreFeature());
    expect(json).not.toContain('"ui"');
    expect(JSON.parse(json)).not.toHaveProperty('ui');
  });

  it('decodes a record with no ui key as count 0', () => {
    const r = decodeAutosave(storedPreFeature());
    expect(r).toBeDefined();
    expect(r!.deflections).toBe(0);
  });

  it('decodes non-object ui and bad deflections as 0 without rejecting', () => {
    const base = JSON.parse(storedPreFeature()) as Record<string, unknown>;
    // NaN is not representable in JSON; JSON.stringify turns it into null.
    const uis: unknown[] = [
      'text', 7, true, null, [],
      { deflections: -1 }, { deflections: 2 }, { deflections: 1.5 },
      { deflections: '1' }, { deflections: Number.NaN },
    ];
    for (const ui of uis) {
      const r = decodeAutosave(JSON.stringify({ ...base, ui }));
      expect(r, JSON.stringify(ui)).toBeDefined();
      expect(r!.deflections, JSON.stringify(ui)).toBe(0);
      expect(r!.prompt).toEqual(prompt);
      expect(r!.lines).toEqual(lines);
    }
  });

  it('ignores unknown keys inside ui', () => {
    const base = JSON.parse(storedPreFeature()) as Record<string, unknown>;
    const r = decodeAutosave(JSON.stringify({ ...base, ui: { deflections: 0, mystery: [1] } }));
    expect(r).toBeDefined();
    expect(r!.deflections).toBe(0);
  });

  it('round-trips count 1', () => {
    const json = encodeAutosave(state, prompt, lines, undefined, 1)!;
    expect(decodeAutosave(json)!.deflections).toBe(1);
  });

  it('counts ui inside the size-limit loop', () => {
    const many: TranscriptLine[] = Array.from({ length: 40 }, (_, i) => ({
      kind: 'original',
      text: 'filler line number ' + i,
      eol: true,
    }));
    const without = encodeAutosave(state, prompt, many)!;
    // A limit that fits the record without ui exactly; the ui key (+ ~20 chars) must force more drops.
    const withUi = encodeAutosave(state, prompt, many, without.length, 1)!;
    expect(withUi.length).toBeLessThanOrEqual(without.length);
    const r = decodeAutosave(withUi)!;
    expect(r.deflections).toBe(1);
    expect(r.lines.length).toBeLessThan(many.length);
  });
});
