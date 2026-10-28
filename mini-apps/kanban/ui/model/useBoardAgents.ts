import { useEffect, useState } from 'react'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { boardApi, type BoardAgent } from '../api/board-client'

export interface BoardAgents {
  agents: BoardAgent[]
  /** Why the list is missing; assignment is then unavailable, never silently empty. */
  error: string | null
  loading: boolean
}

/**
 * The agents a card on this chat's board may be assigned to, read from the host's directory.
 *
 * Asked for, not typed: a free-text name was the old picker, and a name nobody answers to
 * was refused only at submit, after the whole form had been filled in. The list is the one the
 * server resolves `agent` against, so anything picked here is an assignment it accepts.
 */
export function useBoardAgents(sessionId: string): BoardAgents {
  const [loaded, setLoaded] = useState<{ sessionId: string } & Omit<BoardAgents, 'loading'>>()

  useEffect(() => {
    let cancelled = false
    boardApi.agents(sessionId).then(
      (agents) => !cancelled && setLoaded({ sessionId, agents, error: null }),
      (error: unknown) =>
        !cancelled &&
        setLoaded({
          sessionId,
          agents: [],
          error: errorMessage(error, 'The agents for this chat could not be listed.'),
        }),
    )
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Held WITH the session it describes, so switching chats never shows the previous one's agents.
  return loaded?.sessionId === sessionId
    ? { agents: loaded.agents, error: loaded.error, loading: false }
    : { agents: [], error: null, loading: true }
}
