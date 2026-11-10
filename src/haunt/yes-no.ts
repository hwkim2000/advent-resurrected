/**
 * Haunted-mode yes/no help: whole-line aliases ("sure", "nope", ...) become
 * YES or NO before the engine sees them, and anything the classic parser would
 * reject at a yes/no prompt gets a funny nudge instead (the question stays
 * pending, nothing is counted, `step` is not called).
 *
 * New code (not a port). The accept test mirrors the engine's classifyAnswer
 * (C: yes_or_no first word starts with y or n). The hook contracts are
 * declared structurally; this module imports nothing from src/ui.
 */
import { classifyAnswer } from '../engine/io';

export type YesNoPromptKind = 'command' | 'yesno' | 'filename';

export interface YesNoHookContext {
  readonly gameMode: string;
  readonly prompt: YesNoPromptKind;
}

export type YesNoGateResult =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deflect'; readonly lines: readonly string[]; readonly count: false };

const YES_ALIASES: ReadonlySet<string> = new Set([
  'sure', 'ok', 'okay', 'please', 'yeah', 'yep', 'yup', 'absolutely',
  'of course', 'why not', 'yes please',
]);
const NO_ALIASES: ReadonlySet<string> = new Set(['nope', 'nah', 'no thanks', 'no thank you', 'never']);

/** Lowercase, drop punctuation, collapse whitespace. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole-line alias lookup: 'YES', 'NO' or undefined. */
export function aliasAnswer(text: string): 'YES' | 'NO' | undefined {
  const n = normalizeAnswer(text);
  if (YES_ALIASES.has(n)) return 'YES';
  if (NO_ALIASES.has(n)) return 'NO';
  return undefined;
}

/** Input transformer: Haunted (enforced by the registry), yes/no prompts only. */
export function transformYesNo(line: string, ctx: YesNoHookContext): string {
  if (ctx.prompt !== 'yesno') return line;
  return aliasAnswer(line) ?? line;
}

/** Nudges: plain ASCII, at most 160 chars, each with a clear YES or NO cue. */
export const NUDGE_LINES: readonly string[] = [
  'That was a question, not a poem. Please answer YES or NO.',
  'My circuits only speak two words here. Try YES or NO.',
  'Forty-nine years in a PDP-10 and I still need a YES or NO from you.',
  'I heard you, but I cannot file that. Type YES or NO, or just say it.',
];

export interface YesNoNudge {
  next(): string;
}

/** Deterministic rotation through NUDGE_LINES. */
export function createNudgePicker(): YesNoNudge {
  let i = 0;
  return {
    next() {
      const line = NUDGE_LINES[i % NUDGE_LINES.length]!;
      i += 1;
      return line;
    },
  };
}

/** Input gate: nudge when the engine would answer "Please answer the question." */
export function createYesNoGate(
  picker: YesNoNudge = createNudgePicker(),
): (text: string, origin: unknown, deflections: number, ctx: YesNoHookContext) => YesNoGateResult {
  return (text, _origin, _deflections, ctx) => {
    if (ctx.prompt !== 'yesno') return { kind: 'allow' };
    if (classifyAnswer(text) !== 'invalid') return { kind: 'allow' };
    return { kind: 'deflect', lines: [picker.next()], count: false };
  };
}
