// Pure decision for one final speech result (spec: voice-input, Requirements 8.12
// and 9.12). New code for this project; not ported from Open Adventure.
// The Voice_Layer reads no engine state and defines no Meta word list: it uses
// isMetaWord from src/shared/meta-commands.
import { isMetaWord } from '../shared/meta-commands';
import { cleanTranscript } from './clean';
import { DIDNT_CATCH, TYPE_FILE_NAME, TYPE_THAT_COMMAND } from './messages';
import { matchMagicWords } from './magic-match';
import { mapYesNo } from './yes-no';

/** Host facts read at the moment the final result is processed. Fields may be undefined. */
export interface HostSnapshot {
  readonly gameMode: '1976' | 'haunted' | undefined;
  readonly promptKind: 'command' | 'yesno' | 'filename' | undefined;
  readonly phase: 'booting' | 'ready' | 'over' | 'failed' | undefined;
}

export type FinalOutcome =
  | { readonly kind: 'silent' }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'submit'; readonly lines: readonly string[]; readonly heard: string };

/** True when either of the first two space-separated tokens is a Meta word. */
function hasMetaWord(cleaned: string): boolean {
  const tokens = cleaned.split(' ').filter((t) => t.length > 0);
  return tokens.slice(0, 2).some((t) => isMetaWord(t));
}

/**
 * Decide what to do with the Alternatives of one final result. Check order:
 * a silent, b filename, c empty, d yes/no prompt, e command prompt (magic),
 * f Meta block, g submit. Total: never throws.
 */
export function decideFinal(
  alternatives: readonly unknown[],
  host: HostSnapshot,
): FinalOutcome {
  try {
    // (a)
    if (
      host === undefined ||
      host === null ||
      host.phase !== 'ready' ||
      host.promptKind === undefined ||
      host.gameMode !== 'haunted'
    ) {
      return { kind: 'silent' };
    }
    // (b)
    if (host.promptKind === 'filename') {
      return { kind: 'message', text: TYPE_FILE_NAME };
    }
    const list: readonly unknown[] = Array.isArray(alternatives) ? alternatives : [];
    const cleaned0 = cleanTranscript(list[0]);
    // (c)
    if (!/[a-z0-9]/.test(cleaned0)) {
      return { kind: 'message', text: DIDNT_CATCH };
    }
    // (d)
    if (host.promptKind === 'yesno') {
      const yn = mapYesNo(cleaned0);
      if (yn !== null) return { kind: 'submit', lines: [yn], heard: cleaned0 };
      if (hasMetaWord(cleaned0)) return { kind: 'message', text: TYPE_THAT_COMMAND };
      return { kind: 'submit', lines: [cleaned0], heard: cleaned0 };
    }
    // (e)
    if (host.promptKind === 'command') {
      const match = matchMagicWords(list);
      if (match !== null) {
        return {
          kind: 'submit',
          lines: [...match.commands],
          heard: cleanTranscript(list[match.alternativeIndex]),
        };
      }
    }
    // (f)
    if (hasMetaWord(cleaned0)) return { kind: 'message', text: TYPE_THAT_COMMAND };
    // (g)
    return { kind: 'submit', lines: [cleaned0], heard: cleaned0 };
  } catch {
    return { kind: 'silent' };
  }
}
