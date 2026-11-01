import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { scopePath } from '@/shared/routing/routes'

/**
 * Delete a chat from the list. Deleting the one that is open lands on a blank chat in the same
 * project (the project's address without a chat opens a fresh draft there): it used to go to the
 * global home and out of the project the person was working in. Deleting another chat leaves the
 * open one where it is. A failure says so and moves nothing.
 */
export function useDeleteSessionAction({
  activeSessionId,
  deleteSession,
  projectOf,
}: {
  activeSessionId: string | null
  deleteSession: (id: string) => Promise<void>
  /** The project a chat lives in, read before it is gone. */
  projectOf: (id: string) => string | null
}) {
  const navigate = useNavigate()
  return useCallback(
    (id: string) => {
      const wasActive = id === activeSessionId
      const project = projectOf(id)
      return deleteSession(id)
        .then(() => {
          if (wasActive) void navigate(project ? scopePath(project) : '/', { replace: true })
        })
        .catch((e: unknown) => {
          toast.error('Could not delete the conversation', {
            description: errorMessage(e, '') || undefined,
          })
        })
    },
    [activeSessionId, deleteSession, navigate, projectOf],
  )
}
