import { createThrottle } from '../../lib/debounce'
import type { RealtimeResource } from './resources'

/** At most one poke per topic this often: a status read is cheap, but not per downloaded chunk. */
const STATUS_POKE_MS = 1000

export interface StatusSource {
  resource: RealtimeResource
  /** The owner's in-process signal: fires on every change of what its status read returns. */
  subscribe(listener: () => void): () => void
}

/**
 * Status that lives in memory or on disk rather than in a table (a download's progress, an index
 * build) has no notice to record. Its owner signals each move; this pokes the topic, throttled, and
 * clients re-read the status from the owner (P11) instead of polling it.
 */
export function startStatusPokes(
  sources: readonly StatusSource[],
  publish: (resources: RealtimeResource[]) => void,
  intervalMs = STATUS_POKE_MS,
): () => void {
  const stops = sources.map(({ resource, subscribe }) => {
    const throttle = createThrottle(intervalMs)
    const off = subscribe(() => throttle.schedule(() => publish([resource])))
    return () => {
      off()
      throttle.cancel()
    }
  })
  return () => {
    for (const stop of stops) stop()
  }
}
