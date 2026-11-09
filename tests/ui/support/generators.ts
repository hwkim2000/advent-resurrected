// fast-check arbitraries for the crt-terminal-ui tests.
// Reuses tests/support/generators.ts (engine vocabulary) without editing it.

import fc from 'fast-check';
import type { OutputEvent } from '../../../src/engine/index';
import type { LineKind, Mode, Speed, TranscriptLine } from '../../../src/ui/types';
import { vocabCommand } from '../../support/generators';

/* ---- text ---- */

const TEXT_PIECES = [
  'a', 'b', 'z', 'Z', ' ', '  ', '0', '9', '.', ',', '!', '?', '<', '>', '&', '"', "'", '%', '\\', '\t',
  '\n', '\n', '\n\n', '\r\n',
  'é', 'ß', 'ñ', 'Ω', '漢', '字', '🙂', '👻', '𝔘', 'e\u0301',
  '<script>alert(1)</script>', '<img onerror=x>',
];

/** Text that may hold newlines, blank runs, HTML-looking text and non-BMP characters. */
export const arbText: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TEXT_PIECES), { maxLength: 30 })
  .map((parts) => parts.join(''));

/** Text that may be empty, or a lone newline. */
export const arbTextOrEmpty: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constant(''), weight: 1 },
  { arbitrary: arbText, weight: 6 },
);

/* ---- engine events ---- */

const arbChannel = fc.constantFrom('speak', 'sspeak', 'echo', 'io') as fc.Arbitrary<
  'speak' | 'sspeak' | 'echo' | 'io'
>;

const arbTextEvent: fc.Arbitrary<OutputEvent> = fc.record({
  type: fc.constant('text' as const),
  channel: arbChannel,
  blank: fc.boolean(),
  template: fc.oneof(fc.constant(null), arbText),
  text: arbTextOrEmpty,
});

const arbPromptEvent: fc.Arbitrary<OutputEvent> = fc.record({
  type: fc.constant('prompt' as const),
  kind: fc.constantFrom('command', 'yesno', 'filename') as fc.Arbitrary<
    'command' | 'yesno' | 'filename'
  >,
  text: arbTextOrEmpty,
});

/** Any engine OutputEvent: all event types, all text channels. */
export const arbOutputEvent: fc.Arbitrary<OutputEvent> = fc.oneof(
  { arbitrary: arbTextEvent, weight: 6 },
  { arbitrary: arbPromptEvent, weight: 2 },
  fc.record({ type: fc.constant('room-entered' as const), loc: fc.integer({ min: 0, max: 140 }) }),
  fc.record({
    type: fc.constant('lamp-level' as const),
    life: fc.integer({ min: -1, max: 400 }),
    initial: fc.integer({ min: 0, max: 400 }),
  }),
  fc.record({
    type: fc.constant('death' as const),
    cause: fc.constantFrom('dwarf', 'pit', 'bridge', 'nowhere') as fc.Arbitrary<
      'dwarf' | 'pit' | 'bridge' | 'nowhere'
    >,
    count: fc.integer({ min: 0, max: 3 }),
  }),
  fc.record({
    type: fc.constant('reincarnation-offered' as const),
    obituary: fc.integer({ min: 0, max: 20 }),
  }),
  fc.record({
    type: fc.constant('magic-word-used' as const),
    word: fc.constantFrom('XYZZY', 'PLUGH', 'PLOVER', 'FEE', 'FIE', 'FOE', 'FOO'),
  }),
  fc.record({
    type: fc.constant('score' as const),
    score: fc.integer({ min: 0, max: 430 }),
    max: fc.constant(430),
  }),
  fc.record({
    type: fc.constant('game-over' as const),
    score: fc.integer({ min: 0, max: 430 }),
    rank: fc.oneof(fc.constant(null), arbText),
    reason: arbText,
    already: fc.boolean(),
  }),
);

/** A list of engine events (a plausible output of one step). */
export const arbOutputEvents: fc.Arbitrary<OutputEvent[]> = fc.array(arbOutputEvent, { maxLength: 12 });

/* ---- transcript lines ---- */

export const LINE_KINDS: readonly LineKind[] = [
  'original',
  'input',
  'translation',
  'notice',
  'narrator',
  'boot',
];
export const arbLineKind: fc.Arbitrary<LineKind> = fc.constantFrom(...LINE_KINDS);

/** One transcript line; its text never holds a newline (the eol flag carries it). */
export const arbTranscriptLine: fc.Arbitrary<TranscriptLine> = fc.record({
  kind: arbLineKind,
  text: arbText.map((t) => t.replace(/[\r\n]/g, '')),
  eol: fc.boolean(),
});

/* ---- settings ---- */

export const arbMode: fc.Arbitrary<Mode> = fc.constantFrom('1976', 'haunted');
export const arbSpeed: fc.Arbitrary<Speed> = fc.constantFrom<Speed>(20, 60, 120, 300, 'instant');

/** A valid Settings record (mode, speed, crt). */
export const arbSettings: fc.Arbitrary<{ mode: Mode; speed: Speed; crt: boolean }> = fc.record({
  mode: arbMode,
  speed: arbSpeed,
  crt: fc.boolean(),
});

/* ---- command sequences ---- */

/** Real commands that exercise many engine paths. */
export const REAL_COMMANDS: readonly string[] = [
  'get lamp', 'enter', 'xyzzy', 'quit', 'look', 'inventory', 'west', 'east', 'south', 'north',
  'in', 'out', 'plugh', 'light lamp', 'get keys', 'yes', 'no', 'help', 'score', 'save', 'resume',
];

export const arbRealCommand: fc.Arbitrary<string> = fc.constantFrom(...REAL_COMMANDS);

/** Arbitrary strings up to 1023 characters (the input length limit). */
export const arbAnyLine: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.string({ maxLength: 1023 }), weight: 1 },
  { arbitrary: arbText.map((t) => t.slice(0, 1023)), weight: 1 },
);

/** A sequence of input lines: real commands, vocabulary commands and arbitrary strings. */
export const arbCommandSequence: fc.Arbitrary<string[]> = fc.array(
  fc.oneof(
    { arbitrary: arbRealCommand, weight: 5 },
    { arbitrary: vocabCommand, weight: 4 },
    { arbitrary: arbAnyLine, weight: 1 },
  ),
  { maxLength: 30 },
);

/* ---- extension hooks ---- */

/** How a generated hook behaves when called. */
export type HookBehavior = 'ok' | 'throws' | 'invalid';

export interface HookSpec {
  behavior: HookBehavior;
  /** Text appended (transformer), or the narrator line returned, when behavior is 'ok'. */
  tag: string;
}

/** A list of hook behaviors: well-behaved, throwing, and returning the wrong shape. */
export const arbHookList: fc.Arbitrary<HookSpec[]> = fc.array(
  fc.record({
    behavior: fc.constantFrom<HookBehavior>('ok', 'ok', 'throws', 'invalid'),
    tag: fc.string({ minLength: 1, maxLength: 4 }).map((s) => s.replace(/[\r\n]/g, '_')),
  }),
  { maxLength: 6 },
);

/* ---- tick schedules ---- */

/** One step of a schedule: advance to `at` (ms), then optionally flush. */
export interface TickStep {
  at: number;
  flush: boolean;
}

/**
 * Monotone (non-decreasing) tick times starting after `start`, each with an
 * optional flush point. Ends with whatever the last step is; tests may flush
 * afterwards.
 */
export const arbTickSchedule: fc.Arbitrary<TickStep[]> = fc
  .array(
    fc.record({
      dt: fc.integer({ min: 0, max: 400 }),
      flush: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
    }),
    { maxLength: 60 },
  )
  .map((steps) => {
    let t = 0;
    return steps.map((s) => {
      t += s.dt;
      return { at: t, flush: s.flush };
    });
  });
