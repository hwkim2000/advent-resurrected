// Checked-in corpus of ordinary English words (written by hand, no dictionary
// dependency). The matcher must return no match for every entry. It contains
// every word named in Requirement 10.14 and every STOP_LIST word.

import { STOP_LIST } from '../../../src/voice/magic-aliases'

const REQUIRED_WORDS: readonly string[] = [
  'plush', 'plum', 'plus', 'plug in', 'plough', 'flush', 'fizzy', 'dizzy', 'fuzzy',
  'clover', 'lover', 'lovers', 'free', 'feet', "fee's", 'few', 'fly', 'fool', 'food',
  'for', 'four', 'fun', 'fur',
]

const COMMON_WORDS: readonly string[] = [
  'apple', 'bridge', 'candle', 'dragon', 'engine', 'forest', 'garden', 'hammer',
  'island', 'jungle', 'kettle', 'ladder', 'mirror', 'needle', 'orange', 'pillow',
  'queen', 'river', 'silver', 'table', 'umbrella', 'valley', 'window', 'yellow',
  'zebra', 'above', 'above', 'across', 'after', 'again', 'against', 'almost',
  'along', 'always', 'animal', 'another', 'answer', 'around', 'basket', 'battery',
  'beauty', 'because', 'before', 'behind', 'below', 'between', 'bottle', 'bright',
  'broken', 'build', 'butter', 'camera', 'carry', 'castle', 'cellar', 'chair',
  'change', 'cheese', 'circle', 'climb', 'cloud', 'coffee', 'color', 'corner',
  'cotton', 'country', 'courage', 'crystal', 'danger', 'darkness', 'daughter',
  'dinner', 'doctor', 'dollar', 'double', 'dream', 'drink', 'during', 'early',
  'earth', 'eight', 'either', 'empty', 'enough', 'every', 'except', 'family',
  'famous', 'father', 'feather', 'fence', 'field', 'finger', 'finish', 'flower',
  'follow', 'forget', 'friend', 'frozen', 'future', 'gentle', 'ghost', 'glass',
  'golden', 'ground', 'happy', 'heavy', 'honey', 'horse', 'house', 'hundred',
  'hungry', 'iron', 'jacket', 'journey', 'kitchen', 'knife', 'known', 'large',
  'laugh', 'leather', 'letter', 'light', 'little', 'machine', 'market', 'marble',
  'meadow', 'middle', 'minute', 'moment', 'monkey', 'morning', 'mother', 'mountain',
  'music', 'narrow', 'nature', 'neither', 'night', 'noise', 'number', 'office',
  'often', 'paper', 'people', 'pepper', 'picture', 'planet', 'please', 'pocket',
  'powder', 'pretty', 'prince', 'purple', 'rabbit', 'rather', 'reason', 'remember',
  'rocket', 'rubber', 'saddle', 'school', 'season', 'second', 'shadow', 'simple',
  'sister', 'smooth', 'spider', 'spring', 'square', 'stone', 'strange', 'summer',
  'sunset', 'supper', 'thunder', 'ticket', 'tomorrow', 'travel', 'treasure',
  'trouble', 'turkey', 'twelve', 'under', 'village', 'voice', 'wander', 'water',
  'weather', 'wheel', 'whisper', 'winter', 'wonder', 'wooden', 'worry', 'yellow',
  'young', 'zero', 'play', 'plan', 'plant', 'place', 'plain', 'floor', 'flame',
  'flood', 'fleet', 'fresh', 'frame', 'front', 'fruit', 'fever', 'fewer', 'fold',
  'foot', 'force', 'form', 'fork', 'fall', 'fast', 'fat', 'fire', 'fish', 'five',
  'flat', 'flag', 'flow', 'fog', 'fox', 'frog', 'from', 'full', 'fund', 'love',
  'lover', 'lobby', 'lover', 'glove', 'gloves', 'proven', 'power', 'plover', 
]

/** Words that are aliases or Magic_Words themselves; never part of the corpus. */
const NOT_ORDINARY = new Set(['plover', 'plug', 'plu', 'fee', 'fie', 'foe', 'foo', 'fi', 'fo', 'fum'])

export const ORDINARY_WORDS: readonly string[] = [
  ...new Set([...REQUIRED_WORDS, ...COMMON_WORDS, ...STOP_LIST]),
].filter((w) => !NOT_ORDINARY.has(w))
