/**
 * Edit-distance helpers for the voice magic-word matcher.
 *
 * `damerauLevenshtein` is the optimal-string-alignment (OSA) dynamic program and
 * serves as the reference model. `isDistanceOne` is the linear production check.
 * OSA and unrestricted Damerau-Levenshtein agree whenever the distance is at
 * most 1, which is the only value the matcher uses.
 *
 * Pure: no DOM, clock, randomness or I/O. Imports nothing.
 */

/** Optimal string alignment distance: insert, delete, substitute, adjacent swap. */
export function damerauLevenshtein(a: string, b: string): number {
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  const width = lb + 1
  const d = new Array<number>((la + 1) * width).fill(0)
  const at = (i: number, j: number): number => d[i * width + j] ?? 0
  for (let i = 0; i <= la; i++) d[i * width] = i
  for (let j = 0; j <= lb; j++) d[j] = j
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1)
      }
      d[i * width + j] = best
    }
  }
  return at(la, lb)
}

/** True when the OSA distance between `a` and `b` is exactly 1. Linear time. */
export function isDistanceOne(a: string, b: string): boolean {
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (i === la && i === lb) return false // equal
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true // substitution
    return (
      i + 1 < la &&
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    ) // adjacent transposition
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i) // insert/delete
}
