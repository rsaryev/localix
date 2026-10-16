import type { RailEntry } from '../ui/shellTypes'

/**
 * Return a copy of `entries` where every UNPINNED id's `onClick` also records the
 * open, so launching a plugin view floats it into the rail's recent slots.
 *
 * Only unpinned ids are wrapped: a pinned entry already owns a permanent slot, and
 * touching it would let it evict a genuine recent. Pure — no React/DOM — so the
 * decoration can be unit-tested, and cheap enough to run per render (the entry map
 * is rebuilt each render anyway).
 */
export function trackRecentOpens(
  entries: ReadonlyMap<string, RailEntry>,
  unpinnedIds: ReadonlySet<string>,
  onOpen: (id: string) => void,
): Map<string, RailEntry> {
  const tracked = new Map<string, RailEntry>()
  for (const [id, entry] of entries) {
    tracked.set(
      id,
      unpinnedIds.has(id)
        ? {
            ...entry,
            onClick: (event) => {
              onOpen(id)
              entry.onClick(event)
            },
          }
        : entry,
    )
  }
  return tracked
}
