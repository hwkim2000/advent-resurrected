/**
 * Edit-distance helpers for the voice magic-word matcher.
 *
 * `damerauLevenshtein` is the optimal-string-alignment (OSA) dynamic program and
 * serves as the reference model. `isDistanceOne` is the linear production check.
 * OSA and unrestricted Damerau-Levenshtein agree whenever the distance is at
 * most 1, which is the only value the matcher uses.
 *
 * Pure: no DOM, clock, randomness or I/O. Imports only the shared edit distance.
 */

export { damerauLevenshtein } from '../shared/edit-distance'

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
