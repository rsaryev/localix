import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { useResourceRevision } from '@/shared/api/useResourceRevision'
import type { JoinRoutesView } from '@/shared/api/contracts'

/**
 * What each agent not invited yet would join a conversation on — its card, else its last pick,
 * else the project — read from the server's model chain each time the picker opens, so the
 * Agents column shows a newcomer on exactly the model it would get. Read again while open when the
 * server says agents, sessions or the profile changed. Null until it arrives (or
 * when it cannot): those rows then show no model, which is what the picker showed before.
 */
export function useJoinRoutes(sessionId: string | undefined, open: boolean): JoinRoutesView | null {
  const [routes, setRoutes] = useState<JoinRoutesView | null>(null)
  // An agent's card, a session's seats and the profile default all feed the chain.
  const agents = useResourceRevision('capabilities', open)
  const seats = useResourceRevision('sessions', open)
  const profile = useResourceRevision('profile', open)
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
  }, [open, sessionId, agents, seats, profile])
  return routes
}
