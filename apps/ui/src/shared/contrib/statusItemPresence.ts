import { useSyncExternalStore } from 'react'

/**
 * Which contributed status items are currently DRAWING — the set an adaptive strip lays itself out
 * on, and the one thing the registry beside it cannot answer.
 *
 * A contribution is a standing declaration; whether it draws anything is a question its `useItem`
 * answers per session, and most bundled mini apps answer `null` (no open books, no environments, no
 * running port-forwards, no charts). Budgeting the titlebar on declarations therefore spent slots
 * on items that draw nothing: ten registrations, four glyphs, and an `…` whose rows were the two
 * remaining declarations — also `null`, so the menu opened EMPTY. A bar hiding its mini apps behind
 * a button that does nothing is what was reported, and this store is the fix.
 *
 * Presence cannot be asked for, only observed: `useItem` is a hook, so the only place its answer
 * exists is inside a mounted slot. `StatusItems` mounts a slot for EVERY contribution and each one
 * reports what it found here. That is what keeps the loop open — presence is decided by mounting,
 * placement is decided from presence, and placement never feeds back into mounting.
 *
 * A module store rather than React state for the same reason the registry is one: the strip that
 * SIZES the row and the strip that RENDERS it are two components, and both have to read one answer.
 */
const present = new Set<string>()
const listeners = new Set<() => void>()
/** What a render reads: replaced, never changed, so a new answer is a new value. */
let snapshot: ReadonlySet<string> = new Set()

/** Report (from an effect, never during render) whether one item currently draws anything. */
export function reportStatusItemPresence(id: string, live: boolean): void {
  if (present.has(id) === live) return
  if (live) present.add(id)
  else present.delete(id)
  snapshot = new Set(present)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function current(): ReadonlySet<string> {
  return snapshot
}

/**
 * The ids that drew something the last time their slot rendered, for anything laid out on the live
 * set. Absent also covers "has not reported yet", the right reading for both callers: an item
 * nobody has heard from cannot be placed, and it must still be allowed to draw its first frame.
 *
 * A value, not a signal beside a getter: the built app's React Compiler keeps a render's call to a
 * module function on its arguments, so such a call kept its first answer.
 */
export function useStatusItemPresence(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, current, current)
}
