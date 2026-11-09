/**
 * Meta_Command classification pinned against the generated ACTIONS table.
 * Requirements 8.3, 8.12. A change to ACTIONS (or a new session-control action
 * in the dispatcher) must fail this test until the Meta_Command list is reviewed.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../../src/data/dungeon';
import { getActionVocabId } from '../../src/engine/classic-parser';
import { META_ACTION_IDS, META_WORDS, isMetaWord } from '../../src/shared/meta-commands';

/** Fixed expected list: [action id, joined words, is Meta_Command]. Empty entries (ids 0, 41) excluded. */
const EXPECTED: readonly (readonly [number, string, boolean])[] = [
  [1, 'g carry take keep catch steal captu get tote snarf', false],
  [2, 'drop relea free disca dump', false],
  [3, 'say chant sing utter mumbl', false],
  [4, 'unloc open', false],
  [5, 'z nothi', false],
  [6, 'lock close', false],
  [7, 'light on', false],
  [8, 'extin off', false],
  [9, 'wave shake swing', false],
  [10, 'calm placa tame', false],
  [11, 'walk run trave go proce conti explo follo turn', false],
  [12, 'attac kill fight hit strik slay', false],
  [13, 'pour', false],
  [14, 'eat devou', false],
  [15, 'drink', false],
  [16, 'rub', false],
  [17, 'throw toss', false],
  [18, 'quit', true],
  [19, 'find where', false],
  [20, 'i inven', false],
  [21, 'feed', false],
  [22, 'fill', false],
  [23, 'blast deton ignit blowu', false],
  [24, 'score', false],
  [25, 'fee', false],
  [26, 'fie', false],
  [27, 'foe', false],
  [28, 'foo', false],
  [29, 'fum', false],
  [30, 'brief', false],
  [31, 'read perus', false],
  [32, 'break shatt smash', false],
  [33, 'wake distu', false],
  [34, 'suspe pause save', true],
  [35, 'resum resta', true],
  [36, 'fly', false],
  [37, 'liste', false],
  [38, "z'zzz", false],
  [39, 'seed', true],
  [40, 'waste', true],
  [42, 'thank', false],
  [43, 'sesam opens abra abrac shaza hocus pocus', false],
  [44, 'help ?', false],
  [45, 'no', false],
  [46, 'tree trees', false],
  [47, 'dig excav', false],
  [48, 'lost', false],
  [49, 'mist', false],
  [50, 'fuck', false],
  [51, 'stop', false],
  [52, 'info infor', false],
  [53, 'swim', false],
  [54, 'wizar', false],
  [55, 'yes', false],
  [56, 'news', false],
  [57, 'versi', false],
];

const META_IDS = [18, 34, 35, 39, 40];

describe('Meta_Command classification pinned to ACTIONS', () => {
  it('ACTIONS has exactly the expected non-empty entries at the expected ids', () => {
    const actual = ACTIONS.map((a, id) => [id, a.words.join(' ')] as const).filter(
      ([, words]) => words !== '',
    );
    expect(ACTIONS.length).toBe(58);
    expect(ACTIONS.filter((a) => a.words.length === 0).length).toBe(2);
    expect(actual.length).toBe(EXPECTED.length);
    expect(actual).toEqual(EXPECTED.map(([id, words]) => [id, words]));
  });

  it('META_ACTION_IDS is exactly QUIT, SAVE, RESUME, SEED, WASTE (18, 34, 35, 39, 40)', () => {
    expect([...META_ACTION_IDS].sort((a, b) => a - b)).toEqual(META_IDS);
    expect(EXPECTED.filter(([, , meta]) => meta).map(([id]) => id)).toEqual(META_IDS);
  });

  it('every META_WORDS entry resolves to an action in META_ACTION_IDS and is meta', () => {
    for (const w of META_WORDS) {
      const id = getActionVocabId(w, false);
      expect(META_ACTION_IDS.has(id), w).toBe(true);
      expect(isMetaWord(w), w).toBe(true);
    }
  });

  it('every word of every non-empty ACTIONS entry is classified as expected', () => {
    for (const [id, words, meta] of EXPECTED) {
      for (const w of words.split(' ')) {
        expect(isMetaWord(w), `${w} (action ${id})`).toBe(meta);
      }
    }
  });

  it('no non-meta entry is classified as meta, and META_WORDS covers every meta table word', () => {
    const metaTableWords = EXPECTED.filter(([, , m]) => m)
      .flatMap(([, words]) => words.split(' '))
      .sort();
    expect([...META_WORDS].sort()).toEqual(metaTableWords);
    for (const [id, words, meta] of EXPECTED) {
      if (!meta) expect(META_ACTION_IDS.has(id), words).toBe(false);
    }
  });

  it('allows WAKE, BLAST, SCORE, ATTACK, THROW and the magic words', () => {
    for (const w of ['wake', 'blast', 'score', 'attack', 'throw', 'fee', 'fie', 'foe', 'foo', 'fum']) {
      expect(isMetaWord(w), w).toBe(false);
    }
  });

  it('classifies full-length and case variants of meta words (TOKLEN matching)', () => {
    for (const w of ['SUSPEND', 'Resume', 'RESTART', 'PAUSE', 'quit', 'SEED', 'waste']) {
      expect(isMetaWord(w), w).toBe(true);
    }
  });
});
