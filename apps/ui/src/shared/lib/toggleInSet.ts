/**
 * Return a NEW Set with `value` toggled — added if absent, removed if present.
 * Immutable, so it's safe straight inside a `setState(prev => toggleInSet(prev, v))`
 * updater. The de-facto reducer behind every collapse/selection Set in the UI
 * (file tree, search, problems, source-control, media refs).
 */
export function toggleInSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
