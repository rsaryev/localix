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
let revision = 0
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
  revision += 1
  for (const listener of listeners) listener()
}

/** The keys among these the person has not been told about. */
export function unseenRecommendations(keys: readonly string[]): string[] {
  const known = new Set(seen())
  return keys.filter((key) => !known.has(key))
}

/** Re-render when something is marked seen, in this window. */
export const useRecommendationsSeen = (): number =>
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  )
