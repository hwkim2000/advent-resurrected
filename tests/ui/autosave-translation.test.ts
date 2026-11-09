import { describe, it, expect } from 'vitest';
import { newGame, serialize, start } from '../../src/engine/index';
import type { Env } from '../../src/engine/index';
import { AUTOSAVE_LINE_KINDS, AUTOSAVE_MAX_LINES, decodeAutosave } from '../../src/ui/autosave';
import { Transcript } from '../../src/ui/transcript';
import type { TranscriptLine } from '../../src/ui/types';

const env: Env = { storage: { read: () => undefined, write: () => true } };
const stateText = serialize(start(newGame(7), env).state);

function record(lines: unknown[]): string {
  return JSON.stringify({ v: 1, state: stateText, prompt: { kind: 'command', text: '' }, lines });
}

describe('autosave with translation lines', () => {
  it('decodes an older autosave (no translation kind) to the same lines', () => {
    const old: TranscriptLine[] = [
      { kind: 'original', text: 'You are in a building.', eol: true },
      { kind: 'input', text: 'look', eol: true },
      { kind: 'notice', text: 'Saved.', eol: true },
      { kind: 'narrator', text: 'Ahem.', eol: true },
    ];
    const restored = decodeAutosave(record(old));
    expect(restored).toBeDefined();
    expect(restored!.lines).toEqual(old);
  });

  it('default Transcript.tail excludes translation lines; AUTOSAVE_LINE_KINDS includes them', () => {
    const t = new Transcript();
    t.append([
      { kind: 'input', text: "I'll go inside", eol: true },
      { kind: 'translation', text: 'ENTER BUILD', eol: true },
      { kind: 'original', text: 'Inside.', eol: true },
    ]);
    expect(t.tail(10).map((l) => l.kind)).toEqual(['input', 'original']);
    expect(t.tail(AUTOSAVE_MAX_LINES, AUTOSAVE_LINE_KINDS).map((l) => l.kind)).toEqual([
      'input',
      'translation',
      'original',
    ]);
  });

  it('still rejects a record with an unknown line kind', () => {
    expect(decodeAutosave(record([{ kind: 'bogus', text: 'x', eol: true }]))).toBeUndefined();
  });
});
