/**
 * Breadth-preserving sampling — the one owner.
 *
 * Three private copies of `spreadSample` existed (tracked-diff capture, the working diff's
 * untracked list, commit-completion context) and two of `salientAndSpread`. The completion
 * copy drifted: it answered a limit of 0 with ONE item, so its salience pass, which reserves
 * at least one salient pick and hands the remainder to the spread, returned two items for a
 * limit of one — a bound that did not bound.
 */

/**
 * At most `limit` items spread evenly from first to last (both ends kept), in their original
 * order. `undefined` means no limit; a limit of 0 or less selects nothing.
 */
export function spreadSample<T>(items: readonly T[], limit: number | undefined): T[] {
  if (limit === undefined || items.length <= limit) return [...items]
  if (limit <= 0) return []
  if (limit === 1) return [items[0]!]
  const selected: T[] = []
  const seen = new Set<number>()
  for (let slot = 0; slot < limit; slot++) {
    const index = Math.round((slot * (items.length - 1)) / (limit - 1))
    if (seen.has(index)) continue
    seen.add(index)
    selected.push(items[index]!)
  }
  return selected
}

/** What salience ranks on: a stable position and the size of the change. */
export interface SalienceRanked {
  index: number
  changedLines: number
}

/**
 * The largest changes first (70% of the budget, at least one), then an even spread of the
 * rest, so one giant file cannot crowd every other file out. Never exceeds `limit`.
 */
export function salientAndSpread<T extends SalienceRanked>(
  items: readonly T[],
  limit: number,
): T[] {
  if (items.length <= limit) return [...items]
  if (limit <= 0) return []
  const salientCount = Math.max(1, Math.ceil(limit * 0.7))
  const salient = [...items]
    .sort((left, right) => right.changedLines - left.changedLines || left.index - right.index)
    .slice(0, salientCount)
  const salientIndexes = new Set(salient.map((entry) => entry.index))
  const rest = items.filter((entry) => !salientIndexes.has(entry.index))
  return [...salient, ...spreadSample(rest, limit - salient.length)]
}
