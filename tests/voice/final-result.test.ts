// Example tests for decideFinal and mapYesNo (spec: voice-input, task 3.15).
import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/command-validation';
import { decideFinal, type HostSnapshot } from '../../src/voice/final-result';
import { DIDNT_CATCH, TYPE_FILE_NAME, TYPE_THAT_COMMAND } from '../../src/voice/messages';
import { mapYesNo } from '../../src/voice/yes-no';

const CMD: HostSnapshot = { gameMode: 'haunted', promptKind: 'command', phase: 'ready' };
const YESNO: HostSnapshot = { gameMode: 'haunted', promptKind: 'yesno', phase: 'ready' };
const FILE: HostSnapshot = { gameMode: 'haunted', promptKind: 'filename', phase: 'ready' };

const YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'affirmative'];
const NO_WORDS = ['no', 'nope', 'nah', 'negative'];
const META = ['QUIT', 'SAVE', 'RESUME', 'SEED', 'WASTE'];

describe('mapYesNo', () => {
  it.each(YES_WORDS)('maps %s to YES', (w) => {
    expect(mapYesNo(w)).toBe('YES');
  });
  it.each(NO_WORDS)('maps %s to NO', (w) => {
    expect(mapYesNo(w)).toBe('NO');
  });
  it('is a whole-string comparison', () => {
    expect(mapYesNo('yes please')).toBeNull();
    expect(mapYesNo('')).toBeNull();
    expect(mapYesNo('maybe')).toBeNull();
  });
});

describe('decideFinal at a yes/no prompt', () => {
  it.each([...YES_WORDS, ...NO_WORDS])('submits the mapped answer for %s', (w) => {
    const out = decideFinal([w], YESNO);
    expect(out).toEqual({ kind: 'submit', lines: [mapYesNo(w)], heard: w });
  });

  it('submits "yes please" unchanged, not YES', () => {
    expect(decideFinal(['Yes please'], YESNO)).toEqual({
      kind: 'submit',
      lines: ['yes please'],
      heard: 'yes please',
    });
  });

  it('submits an unlisted answer unchanged', () => {
    expect(decideFinal(['maybe'], YESNO)).toEqual({
      kind: 'submit',
      lines: ['maybe'],
      heard: 'maybe',
    });
  });

  it('does not run the magic matcher', () => {
    expect(decideFinal(['xyzzy'], YESNO)).toEqual({
      kind: 'submit',
      lines: ['xyzzy'],
      heard: 'xyzzy',
    });
  });

  it('uses only the first Alternative', () => {
    expect(decideFinal(['maybe', 'yes'], YESNO)).toEqual({
      kind: 'submit',
      lines: ['maybe'],
      heard: 'maybe',
    });
  });

  it.each(META)('withholds %s', (w) => {
    expect(decideFinal([w.toLowerCase()], YESNO)).toEqual({
      kind: 'message',
      text: TYPE_THAT_COMMAND,
    });
  });
});

describe('decideFinal at a filename prompt', () => {
  it('shows the type-the-file-name message and submits no line', () => {
    expect(decideFinal(['my save'], FILE)).toEqual({ kind: 'message', text: TYPE_FILE_NAME });
    expect(decideFinal(['xyzzy'], FILE)).toEqual({ kind: 'message', text: TYPE_FILE_NAME });
  });
});

describe('decideFinal Meta words at a command prompt', () => {
  it.each(META)('withholds %s alone', (w) => {
    expect(decideFinal([w.toLowerCase()], CMD)).toEqual({
      kind: 'message',
      text: TYPE_THAT_COMMAND,
    });
  });

  it.each(META)('withholds %s as the second word', (w) => {
    expect(decideFinal([`please ${w.toLowerCase()}`], CMD)).toEqual({
      kind: 'message',
      text: TYPE_THAT_COMMAND,
    });
  });

  it.each(['suspend', 'pause', 'restart'])('withholds vocabulary spelling %s', (w) => {
    expect(decideFinal([w], CMD)).toEqual({ kind: 'message', text: TYPE_THAT_COMMAND });
  });

  it('passes on a Meta word beyond the first two words, and validateCommand rejects it', () => {
    const text = 'i would like to save the game';
    const out = decideFinal([text], CMD);
    expect(out).toEqual({ kind: 'submit', lines: [text], heard: text });
    expect(validateCommand('SAVE').ok).toBe(false);
    expect(validateCommand('PLEASE SAVE').ok).toBe(false);
  });
});

describe('decideFinal at a command prompt', () => {
  it('lets a Magic_Match win over a classic command', () => {
    const out = decideFinal(['go', 'xyzzy'], CMD);
    // first Alternative "go" is a classic command, but the second matches a magic word
    expect(out.kind).toBe('submit');
    if (out.kind === 'submit') {
      expect(out.lines).toEqual(['XYZZY']);
      expect(out.heard).toBe('xyzzy');
    }
  });

  it('submits a Magic_Match for a plain spoken magic word', () => {
    expect(decideFinal(['Xyzzy.'], CMD)).toEqual({
      kind: 'submit',
      lines: ['XYZZY'],
      heard: 'xyzzy',
    });
  });

  it('submits the cleaned first Alternative when nothing matches', () => {
    expect(decideFinal(['Go West!'], CMD)).toEqual({
      kind: 'submit',
      lines: ['go west'],
      heard: 'go west',
    });
  });

  it('reports DIDN\'T CATCH THAT for empty or symbol-only text', () => {
    expect(decideFinal([''], CMD)).toEqual({ kind: 'message', text: DIDNT_CATCH });
    expect(decideFinal([], CMD)).toEqual({ kind: 'message', text: DIDNT_CATCH });
    expect(decideFinal(['...'], CMD)).toEqual({ kind: 'message', text: DIDNT_CATCH });
  });
});

describe('decideFinal reads the snapshot at decision time', () => {
  it('gives different outcomes for different prompt kinds', () => {
    expect(decideFinal(['yes'], CMD)).toEqual({ kind: 'submit', lines: ['yes'], heard: 'yes' });
    expect(decideFinal(['yes'], YESNO)).toEqual({ kind: 'submit', lines: ['YES'], heard: 'yes' });
    expect(decideFinal(['yes'], FILE).kind).toBe('message');
  });

  it('reflects a snapshot that changes between two calls', () => {
    const host = { gameMode: 'haunted', promptKind: 'command', phase: 'ready' } as {
      gameMode: HostSnapshot['gameMode'];
      promptKind: HostSnapshot['promptKind'];
      phase: HostSnapshot['phase'];
    };
    expect(decideFinal(['xyzzy'], host).kind).toBe('submit');
    host.phase = 'over';
    expect(decideFinal(['xyzzy'], host)).toEqual({ kind: 'silent' });
    host.phase = 'ready';
    host.promptKind = 'filename';
    expect(decideFinal(['xyzzy'], host).kind).toBe('message');
  });

  it('is silent when phase, prompt kind or mode is not usable', () => {
    expect(decideFinal(['xyzzy'], { ...CMD, phase: 'booting' })).toEqual({ kind: 'silent' });
    expect(decideFinal(['xyzzy'], { ...CMD, phase: undefined })).toEqual({ kind: 'silent' });
    expect(decideFinal(['xyzzy'], { ...CMD, promptKind: undefined })).toEqual({ kind: 'silent' });
    expect(decideFinal(['xyzzy'], { ...CMD, gameMode: '1976' })).toEqual({ kind: 'silent' });
    expect(decideFinal(['xyzzy'], { ...CMD, gameMode: undefined })).toEqual({ kind: 'silent' });
  });
});
