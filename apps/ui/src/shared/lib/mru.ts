// Move-to-front MRU update: returns a NEW array with `item` at the front and any
// earlier occurrence removed (dedupe), optionally capped to `max` entries (oldest
// dropped). Pure — the caller owns where the list lives (a store slice, the
// recent-files palette, the group focus order, …).
//
// Dedupe is by reference identity (`!==`) by default, which is what a list of
// strings/ids wants. A list of VALUE objects (two distinct objects that mean the
// same entry) passes an `isSame` comparator instead — otherwise the caller is
// forced to encode each object into a synthetic string key just to be comparable,
// and then parse it back out again.

export function pushMru<T>(
  list: readonly T[],
  item: T,
  max?: number,
  isSame: (a: T, b: T) => boolean = (a, b) => a === b,
): T[] {
  const next = [item, ...list.filter((x) => !isSame(x, item))]
  return max === undefined ? next : next.slice(0, Math.max(0, max))
}
