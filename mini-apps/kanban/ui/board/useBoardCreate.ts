import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { boardApi } from '../api/board-client'
import { acceptTask } from '../model/boardStore'

export interface BoardQuickCreate {
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  busy: boolean
  /** Create a backlog card from the quick row's title alone. */
  create: () => Promise<void>
}

/**
 * The quick-create row's state and its one action: a card on THIS chat's board, from its title.
 *
 * The card shows as soon as the server answers rather than when the stream echoes it, so typing
 * the next title never races a row that has not appeared yet.
 */
export function useBoardCreate(sessionId: string): BoardQuickCreate {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const create = useCallback(async () => {
    const title = draft.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      acceptTask(sessionId, await boardApi.create(sessionId, { title }))
      setDraft('')
    } catch (error) {
      // The headline stays the classification; the server's own sentence rides as the body.
      toast.error('Could not create the task', {
        description: errorMessage(error, '') || undefined,
      })
    } finally {
      setBusy(false)
    }
  }, [draft, busy, sessionId])

  return { draft, setDraft, busy, create }
}
