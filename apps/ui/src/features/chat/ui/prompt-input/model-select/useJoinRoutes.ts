import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { JoinRoutesView } from '@/shared/api/contracts'

/**
 * What each agent not invited yet would join a conversation on — its card, else its last pick,
 * else the project — read from the server's model chain each time the picker opens, so the
 * Agents column shows a newcomer on exactly the model it would get. Null until it arrives (or
 * when it cannot): those rows then show no model, which is what the picker showed before.
 */
export function useJoinRoutes(sessionId: string | undefined, open: boolean): JoinRoutesView | null {
  const [routes, setRoutes] = useState<JoinRoutesView | null>(null)
  useEffect(() => {
    if (!sessionId || !open) return
    const controller = new AbortController()
    backendClient
      .getJoinRoutes(sessionId, controller.signal)
      .then(setRoutes)
      .catch(() => {
        if (!controller.signal.aborted) setRoutes(null)
      })
    return () => controller.abort()
  }, [open, sessionId])
  return routes
}
