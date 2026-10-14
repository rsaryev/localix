/**
 * Where a dragged row lands — the one piece of reorder arithmetic worth stating once.
 *
 * Given the list INCLUDING the dragged id, which id is in flight, which id the pointer is
 * over, and whether it is past that row's midpoint, this answers the insertion index in the
 * list WITH THE DRAGGED ID REMOVED.
 *
 * Operating on the removed-list is what keeps the landing index correct regardless of whether
 * the dragged row sat before or after the target. Computing it against the original list is
 * the classic off-by-one that drops a row one place from where the caret said it would go,
 * and it only shows up when dragging DOWNWARD — which is why it survives casual testing.
 */
export function computeDropIndex(
  itemsIncludingDragged: readonly string[],
  draggedId: string,
  targetId: string,
  after: boolean,
): number {
  const filtered = itemsIncludingDragged.filter((id) => id !== draggedId)
  const targetIndex = filtered.indexOf(targetId)
  if (targetIndex < 0) return filtered.length // target gone → append
  return after ? targetIndex + 1 : targetIndex
}

/** Move one item to an index in the list with it already removed. Pure; never mutates. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved!)
  return next
}
