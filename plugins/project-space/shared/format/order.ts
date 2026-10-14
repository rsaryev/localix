import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Stacking order as fractional indices: each element carries a key that
 * sorts between its neighbours', so bringing one element forward rewrites that one element —
 * not a renumbered list, which turned every reorder into a diff of the whole file and made two
 * concurrent reorders collide.
 */
export function isOrderKey(key: string): boolean {
  try {
    generateKeyBetween(key, null)
    return true
  } catch {
    return false
  }
}

export const keyBetween = (below: string | null, above: string | null) =>
  generateKeyBetween(below, above)

export const keysAbove = (below: string | null, count: number) =>
  generateNKeysBetween(below, null, count)

/** `count` keys in order between two neighbours (either may be the open end). */
export const keysBetween = (below: string | null, above: string | null, count: number) =>
  generateNKeysBetween(below, above, count)

/** The highest and the lowest key among some elements; null when there are none. */
export function topKey(elements: Iterable<{ z: string }>): string | null {
  let top: string | null = null
  for (const { z } of elements) if (top === null || z > top) top = z
  return top
}

export function bottomKey(elements: Iterable<{ z: string }>): string | null {
  let bottom: string | null = null
  for (const { z } of elements) if (bottom === null || z < bottom) bottom = z
  return bottom
}

/** Lowest-first, ties broken by id so two equal keys (a hand-merged file) still sort one way. */
export function byOrder<T extends { id: string; z: string }>(a: T, b: T): number {
  if (a.z !== b.z) return a.z < b.z ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
