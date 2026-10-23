import { useEffect } from 'react'
import { runAsBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'
import type { KubePod } from '../../backend/contracts'
import { pollIntervalFor, SLOW_POLL_MS } from './watchPace'

/**
 * The poll's next delay, or `null` for none. Pods AND the other collections streaming
 * (`covered`): every change arrives as a frame and a reconnect re-reads, so a timer would only
 * re-list an unchanged cluster. Pods alone: the other collections keep a slow re-read. Neither:
 * the poll is the feed, fast while a pod is in flux, slow once settled.
 */
export function podPollDelay(input: {
  covered: boolean
  podsLive: boolean
  pods: KubePod[]
}): number | null {
  if (input.covered) return null
  return input.podsLive ? SLOW_POLL_MS * 4 : pollIntervalFor(input.pods)
}

/**
 * Poll pods for the active namespace. When the pod and collection watches both stream it reads
 * once (on mount, a scope change, or coverage flipping) and then waits for frames. Otherwise it
 * drives the feed with {@link podPollDelay}'s cadence. A
 * self-scheduling setTimeout (not setInterval) so the interval re-derives each cycle
 * and a slow refresh never overlaps the next tick. Honors the same visibility
 * contract as `useVisiblePolling` (which can't be reused here — its cadence is
 * fixed, ours is adaptive): a hidden tab makes NO steady round-trips.
 *
 * Extracted from `useKubernetes` unchanged; the refs are the hook's own (stable),
 * so listing them in the deps adds no re-runs.
 */
export function usePodPollLoop({
  enabled,
  namespace,
  refresh,
  watchLiveRef,
  podsRef,
  covered,
}: {
  enabled: boolean
  namespace: string
  refresh: (opts?: { forceSecondary?: boolean; silent?: boolean }) => Promise<void>
  watchLiveRef: React.MutableRefObject<boolean>
  podsRef: React.MutableRefObject<KubePod[]>
  /** The pod watch and the collection watch are both live. */
  covered: boolean
}): void {
  useEffect(() => {
    if (!enabled || !namespace) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    const tick = async (opts?: { forceSecondary?: boolean; silent?: boolean }) => {
      inFlight = true
      await refresh(opts)
      inFlight = false
      if (stopped || document.visibilityState !== 'visible') return
      const delay = podPollDelay({
        covered,
        podsLive: watchLiveRef.current,
        pods: podsRef.current,
      })
      if (delay === null) return
      timer = setTimeout(() => {
        timer = undefined
        void runAsBackgroundWork(tick)
      }, delay)
    }
    // Every collection: coverage flipping may have hidden a change from both the poll and the feed.
    void tick({ forceSecondary: true, silent: true })
    // A focus refresh always pulls the full picture (secondary lists included) so a
    // returning user sees a fully fresh view without waiting for the slow-poll window.
    const onFocus = () => void refresh({ forceSecondary: true })
    // Hiding parks the loop (clears the pending timer; an in-flight tick simply doesn't
    // reschedule); returning runs one full refresh and resumes it — guarded on
    // `stopped`/`inFlight`/`timer` so a race with an in-flight tick can't start two loops.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
        return
      }
      if (!stopped && !inFlight && !timer) void tick({ forceSecondary: true })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, namespace, refresh, watchLiveRef, podsRef, covered])
}
