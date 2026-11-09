/**
 * Meta_Commands: session-control actions the AI must never produce
 * (quit, suspend/pause, save, resume/restart, seed, waste). New code.
 */
import { getActionVocabId } from '../engine/classic-parser';
import { WORD_NOT_FOUND } from '../engine/objects';
import { lookupWord } from './vocabulary';

/** Table spellings (first TOKLEN characters) of the session-control words. */
export const META_WORDS = [
  'quit',
  'suspe',
  'pause',
  'save',
  'resum',
  'resta',
  'seed',
  'waste',
] as const;

function computeMetaActionIds(): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const w of META_WORDS) {
    const id = getActionVocabId(w, false);
    if (id !== WORD_NOT_FOUND) ids.add(id);
  }
  return ids;
}

/** Action ids of the Meta_Commands, computed at load. */
export const META_ACTION_IDS: ReadonlySet<number> = computeMetaActionIds();

/** True when the word resolves to an action whose id is a Meta_Command. */
export function isMetaWord(word: string): boolean {
  const hit = lookupWord(word);
  return hit !== undefined && hit.cls === 'action' && META_ACTION_IDS.has(hit.id);
}
