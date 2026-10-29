import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

/**
 * Which recommended packages the person has already been told about, remembered across launches
 * on this device. The composer's notice shows only while something suited is not among them; the
 * Store's row lists every recommendation anyway, so forgetting this loses nothing.
 */
const SEEN = 'localix.store.recommendations.seen'
/** The most recent keys kept; an old one forgotten only means it may be told about again. */
const KEPT = 200

/** The one key a recommended package is remembered by, wherever it was seen. */
export const recommendationKey = (ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`

const listeners = new Set<() => void>()
/** The stored list last read, and the set made of it: a new set only when the list changed. */
let told: { raw: string | null; keys: ReadonlySet<string> } | null = null
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function seen(): string[] {
  try {
    const parsed: unknown = JSON.parse(loadString(SEEN) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

/** These packages were told about: shown in the Store, or the notice hidden. */
export function markRecommendationsSeen(keys: readonly string[]): void {
  const known = seen()
  const fresh = keys.filter((key) => !known.includes(key))
  if (!fresh.length) return
  // A blocked store keeps nothing; the notice then shows again on the next launch.
  saveString(SEEN, JSON.stringify([...known, ...fresh].slice(-KEPT)))
  for (const listener of listeners) listener()
}

/** The keys among these the person has not been told about; `seen` from {@link useSeenRecommendations}. */
export function unseenRecommendations(
  keys: readonly string[],
  seen: ReadonlySet<string>,
): string[] {
  return keys.filter((key) => !seen.has(key))
}

const EMPTY: ReadonlySet<string> = new Set()
function current(): ReadonlySet<string> {
  const raw = loadString(SEEN)
  if (told?.raw !== raw) told = { raw, keys: new Set(seen()) }
  return told.keys
}

/**
 * What the person has been told about, read again when something is marked seen in this window. A
 * value rather than a re-render signal: the built app's React Compiler keeps a render's call to a
 * module function on its arguments, so the notice stayed after it was seen.
 */
export const useSeenRecommendations = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, current, () => EMPTY)
