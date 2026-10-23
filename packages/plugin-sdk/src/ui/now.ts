import { useEffect, useState } from 'react'
import { useWorkItemVisible } from './visibility'

/**
 * The current time, re-read every `intervalMs` while the view is visible.
 *
 * Anything that counts — a countdown, "updated 3s ago", an elapsed time — is DERIVED: the backend
 * keeps the timestamp, and the view renders it against this clock. A count kept in component
 * state stops while the pane is hidden, restarts when it remounts and is invisible to the agent's
 * tools; a clock only re-renders, so hiding the pane pauses nothing that matters, and the value is
 * right again on the first tick after it reappears.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const visible = useWorkItemVisible()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled || !visible) return
    const tick = () => setNow(Date.now())
    // Re-read at once when the view comes back, not a whole interval later.
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [enabled, visible, intervalMs])
  return now
}
