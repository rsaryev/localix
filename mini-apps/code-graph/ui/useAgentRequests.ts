import { useState } from 'react'
import type { AgentView } from '../shared/view'
import { useGraphStream } from './graphStream'

/**
 * The agent's requests for this chat's map, as they are made.
 *
 * They used to arrive through a long-poll re-issued every second while the tab was visible; the
 * stream pushes each one instead, and the snapshot poll still carries the latest as its backstop
 * (a request made while the tab was closed, or while the socket was down).
 */
export function useAgentRequests(active: boolean, sessionId: string | null) {
  const [received, setReceived] = useState<{ sessionId: string; agent: AgentView } | null>(null)
  useGraphStream(sessionId, active, {
    agent: (agent) => {
      if (!sessionId) return
      setReceived((current) =>
        current?.sessionId === sessionId && current.agent.revision >= agent.revision
          ? current
          : { sessionId, agent },
      )
    },
  })
  return received?.sessionId === sessionId ? received.agent : undefined
}
