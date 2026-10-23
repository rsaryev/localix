import { useEffect, useState } from 'react'
import { enqueueMicrotask } from '@localixai/mini-app-sdk/ui'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

/**
 * A one-second wall clock that stops with its keep-alive work item.
 *
 * Trading countdowns only need time while they can paint. Keeping their intervals alive under
 * `display:none` made every parked chart re-render once a second. On resume, a microtask refreshes
 * the held timestamp immediately instead of showing the stale parked value for a full tick.
 */
export function useSecondTick(enabled: boolean): number {
  const workItemVisible = useWorkItemVisible()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || !workItemVisible) return
    let alive = true
    const tick = () => {
      if (alive) setNow(Date.now())
    }
    enqueueMicrotask(tick)
    const timer = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled, workItemVisible])

  return now
}
