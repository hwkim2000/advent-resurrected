// Developer helper (not run by `npm test`, offline only): prints every string at
// Damerau-Levenshtein distance 1 from xyzzy, plugh and plover, so a human can
// review STOP_LIST and ORDINARY_WORDS.
//
//   npx tsx scripts/voice-near-words.ts [--dict <word-list-file>]
//
// With --dict, only candidates found in the (one word per line) list are printed.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CANONICAL_WORDS = ['xyzzy', 'plugh', 'plover'] as const
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

/** All strings at distance exactly 1 (insert, delete, substitute, swap adjacent). */
export function distanceOneNeighbours(word: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i <= word.length; i++) {
    for (const c of ALPHABET) out.add(word.slice(0, i) + c + word.slice(i))
  }
  for (let i = 0; i < word.length; i++) {
    out.add(word.slice(0, i) + word.slice(i + 1))
    for (const c of ALPHABET) out.add(word.slice(0, i) + c + word.slice(i + 1))
    if (i + 1 < word.length) {
      out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2))
    }
  }
  out.delete(word)
  return out
}

export function candidates(dictionary?: ReadonlySet<string>): string[] {
  const all = new Set<string>()
  for (const w of CANONICAL_WORDS) for (const n of distanceOneNeighbours(w)) all.add(n)
  const list = [...all].filter((w) => dictionary === undefined || dictionary.has(w))
  return list.sort()
}

function main(args: readonly string[]): number {
  let dictionary: Set<string> | undefined
  const at = args.indexOf('--dict')
  if (at >= 0) {
    const file = args[at + 1]
    if (file === undefined) {
      console.error('--dict needs a file')
      return 1
    }
    dictionary = new Set(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l !== ''),
    )
  }
  for (const w of candidates(dictionary)) console.log(w)
  return 0
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2))
}
