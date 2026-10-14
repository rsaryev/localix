import { useEffect } from 'react'
import { runAsBackgroundWork } from '@localixai/plugin-sdk/ui/visibility'
import type { KubePod } from '../../backend/contracts'
import { pollIntervalFor, SLOW_POLL_MS } from './watchPace'

/**
 * Poll pods for the active namespace. When a live watch is streaming, pods update
 * from watch frames and polling drops to a slow SAFETY re-sync (catching any missed
 * delta). When the watch is down/unavailable it drives the whole feed with the
 * ADAPTIVE cadence (fast while a pod is in flux, slow once settled). A
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
}: {
  enabled: boolean
  namespace: string
  refresh: (opts?: { forceSecondary?: boolean }) => Promise<void>
  watchLiveRef: React.MutableRefObject<boolean>
  podsRef: React.MutableRefObject<KubePod[]>
}): void {
  useEffect(() => {
    if (!enabled || !namespace) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    const nextDelay = () =>
      watchLiveRef.current ? SLOW_POLL_MS * 4 : pollIntervalFor(podsRef.current)
    const tick = async (opts?: { forceSecondary?: boolean }) => {
      inFlight = true
      await refresh(opts)
      inFlight = false
      if (stopped || document.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        timer = undefined
        void runAsBackgroundWork(tick)
      }, nextDelay())
    }
    void tick()
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
  }, [enabled, namespace, refresh, watchLiveRef, podsRef])
}
