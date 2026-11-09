// fast-check arbitraries for adversarial ai-parser inputs (task 3.3).
import fc from 'fast-check';
import { ALL_INJECTION_PAYLOADS } from './injection-corpus';

/** Adversarial player text: empty, whitespace, huge, non-ASCII, NUL, corpus strings. */
export const arbAdversarialText: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 2, arbitrary: fc.stringMatching(/^[ \t\n\r\u00A0\u2003]{1,50}$/) },
  { weight: 3, arbitrary: fc.string({ unit: 'binary', maxLength: 300 }) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 100 }) },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `${s}\u0000${s}`) },
  {
    weight: 1,
    arbitrary: fc.string({ minLength: 1, maxLength: 20 }).chain((s) =>
      fc.integer({ min: 201, max: 10000 }).map((n) => s.repeat(Math.ceil(n / s.length)).slice(0, n)),
    ),
  },
  { weight: 3, arbitrary: fc.constantFrom(...ALL_INJECTION_PAYLOADS) },
);

/** Arbitrary Provider output: strings, empty, over-length, non-strings, malformed objects. */
export const arbProviderOutput: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 31, maxLength: 500 }),
  fc.constantFrom('NOCOMMAND', 'QUIT', 'SAVE', 'ENTER BUILDING', '"GO NORTH"', '`TAKE LAMP`', 'ENTER BUILDING NOW', 'go\nnorth'),
  fc.constantFrom(undefined, null, 0, 1, true, false, NaN),
  fc.array(fc.string({ maxLength: 10 }), { maxLength: 3 }),
  fc.record({ response: fc.oneof(fc.string({ maxLength: 40 }), fc.integer(), fc.constant(null)) }),
  fc.record({ choices: fc.array(fc.record({ message: fc.record({ content: fc.anything() }) }), { maxLength: 2 }) }),
  fc.constantFrom('{"command":', '[object Object]', '{{{{', '\u0000'),
);

/** A well-formed baseline context used as the base for mutations. */
export const BASE_CONTEXT = { room: "You're in a small building.", objects: ['LAMP'], last: ['GO NORTH'] } as const;

export interface ContextMutation {
  readonly name: string;
  readonly context: unknown;
}

/** Contexts that must all be rejected by strict validation. */
export const arbContextMutation: fc.Arbitrary<ContextMutation> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).map((k) => ({
    name: 'extra-field',
    context: { ...BASE_CONTEXT, objects: [...BASE_CONTEXT.objects], last: [...BASE_CONTEXT.last], [`x${k}`]: 'y' },
  })),
  fc.constantFrom<unknown>(null, 5, 'room', [], true).map((v) => ({ name: 'wrong-type-root', context: v })),
  fc.constantFrom<unknown>(null, 5, ['a'], {}).map((v) => ({ name: 'wrong-type-room', context: { room: v, objects: [], last: [] } })),
  fc.constantFrom<unknown>(null, 'LAMP', 7, { 0: 'LAMP' }).map((v) => ({ name: 'wrong-type-objects', context: { room: 'x', objects: v, last: [] } })),
  fc.constantFrom<unknown>(null, 'GO', 7, [5], [null]).map((v) => ({ name: 'wrong-type-last', context: { room: 'x', objects: [], last: v } })),
  fc.integer({ min: 81, max: 2000 }).map((n) => ({ name: 'room-too-long', context: { room: 'a'.repeat(n), objects: [], last: [] } })),
  fc.integer({ min: 13, max: 60 }).map((n) => ({ name: 'too-many-objects', context: { room: 'x', objects: Array.from({ length: n }, () => 'LAMP'), last: [] } })),
  fc.integer({ min: 3, max: 10 }).map((n) => ({ name: 'too-many-last', context: { room: 'x', objects: [], last: Array.from({ length: n }, () => 'GO NORTH') } })),
  fc.constantFrom(...ALL_INJECTION_PAYLOADS).map((p) => ({ name: 'injected-room', context: { room: p, objects: [], last: [] } })),
  fc.constantFrom(...ALL_INJECTION_PAYLOADS).map((p) => ({ name: 'injected-object', context: { room: 'x', objects: [p], last: [] } })),
  fc.constantFrom(...ALL_INJECTION_PAYLOADS).map((p) => ({ name: 'injected-last', context: { room: 'x', objects: [], last: [p] } })),
  fc.constantFrom('QUIT', 'SAVE', 'RESUM', 'SEED', 'WASTE', 'NOCOMMAND', 'go north', 'GO  NORTH', 'A B C').map((c) => ({ name: 'out-of-set-last', context: { room: 'x', objects: [], last: [c] } })),
  fc.constantFrom('', 'lamp', 'LAMP1', 'ABCDEFGHIJKLM', 'ZZZZ').map((o) => ({ name: 'out-of-set-object', context: { room: 'x', objects: [o], last: [] } })),
  fc.constantFrom('', 'a "quoted" room', 'tab\there', 'line\nbreak', 'caf\u00e9', 'room <b>').map((r) => ({ name: 'out-of-set-room', context: { room: r, objects: [], last: [] } })),
);
