// Magic word data for the voice matcher (data only; the alias index is built in
// magic-match.ts to avoid an import cycle). Source, not generated.

/** Canonical command for each Magic_Word. */
export type MagicCommand = 'XYZZY' | 'PLUGH' | 'PLOVER' | 'FEE' | 'FIE' | 'FOE' | 'FOO'

/** Spoken spellings (aliases) per canonical command. */
export const MAGIC_ALIASES: Readonly<Record<MagicCommand, readonly string[]>> = {
  XYZZY: ['xyzzy', 'zizzy', 'sizzy', 'xizzy', 'zyzzy', 'x y z z y'],
  PLUGH: ['plugh', 'plug', 'plu', 'plug h'],
  PLOVER: ['plover', 'plovers', "plover's", 'plove'],
  FEE: ['fee'],
  FIE: ['fie', 'fi'],
  FOE: ['foe', 'fo'],
  FOO: ['foo', 'fum'],
}

/** Optional lead-ins, longest first; at most one is removed. */
export const LEAD_INS: readonly string[] = [
  'say the magic word',
  'say the word',
  'the word',
  'magic word',
  'say',
]

/**
 * Ordinary English words that sit at edit distance 1 from XYZZY, PLUGH or PLOVER
 * (or close enough to be mistaken for them). The edit tier never accepts these.
 */
export const STOP_LIST: readonly string[] = [
  'plush',
  'plugs',
  'plough',
  'plum',
  'plus',
  'plume',
  'plumb',
  'flush',
  'blush',
  'slush',
  'brush',
  'clover',
  'lover',
  'lovers',
  'prover',
  'glover',
  'plower',
  'hover',
  'cover',
  'fizzy',
  'dizzy',
  'fuzzy',
  'frizzy',
  'jazzy',
  'tizzy',
  'muzzy',
  'buzzy',
  'woozy',
  'fussy',
  'fizzle',
  'sizzle',
  'pluck',
  'plugged',
  'plunge',
  'plumber',
  'pledge',
]
