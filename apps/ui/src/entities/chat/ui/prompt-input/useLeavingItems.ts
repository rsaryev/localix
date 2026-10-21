import { useEffect, useState } from 'react'

export interface PresentEntry<T> {
  item: T
  /** Gone from the source list; kept for one exit beat so it can collapse instead of vanishing. */
  leaving: boolean
}

/**
 * A list that lets its removed entries leave on screen.
 *
 * A queue row unmounted the instant its turn started, so the rows under it jumped up by a row
 * height in one frame. Each removed entry stays at the place it had, flagged `leaving`, for
 * `exitMs`; the caller animates it out and everything below slides up with it.
 *
 * Derived during render ("adjust state when a prop changes"), so the first paint after a change
 * already holds the leaving entry, and no frame shows the list without it.
 */
export function useLeavingItems<T extends { id: string }>(
  items: readonly T[],
  exitMs: number,
): PresentEntry<T>[] {
  const [source, setSource] = useState(items)
  const [entries, setEntries] = useState<PresentEntry<T>[]>(() =>
    items.map((item) => ({ item, leaving: false })),
  )
  if (source !== items) {
    setSource(items)
    const present = new Set(items.map((item) => item.id))
    const next: PresentEntry<T>[] = items.map((item) => ({ item, leaving: false }))
    entries.forEach((entry, index) => {
      if (!present.has(entry.item.id))
        next.splice(Math.min(index, next.length), 0, { item: entry.item, leaving: true })
    })
    setEntries(next)
  }
  useEffect(() => {
    if (!entries.some((entry) => entry.leaving)) return
    const timer = window.setTimeout(
      () => setEntries((current) => current.filter((entry) => !entry.leaving)),
      exitMs,
    )
    return () => window.clearTimeout(timer)
  }, [entries, exitMs])
  return entries
}
