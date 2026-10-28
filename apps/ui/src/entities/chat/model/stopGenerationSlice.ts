import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { findSessionInState } from './findSession'
import { restoreStoppedQueue } from './restoreStoppedQueue'
import { applyServerSession } from './sessionSync'
import type { ChatStore } from './store'

export interface StopGenerationActions {
  /**
   * Stop a session's run. The server owns cancellation; a stop never delivers what was queued
   * behind the run: those messages come back and land in the composer.
   */
  stopGeneration: (sessionId: string) => void
}

export function createStopGenerationActions({
  get,
}: {
  get: () => ChatStore
}): StopGenerationActions {
  return {
    stopGeneration: (sessionId) => {
      if (!sessionId) return
      const wasRunning = findSessionInState(get(), sessionId)?.isRunning ?? false
      get()._setSessionRunning(sessionId, false)
      const optimisticStop = findSessionInState(get(), sessionId)
      // No "the person stopped it" marker here any more: the server records no finished-run row
      // for a stopped run (`notifications/producers/runs.ts`), so there is nothing to suppress.
      void backendClient.stop(sessionId).then(
        (result) => {
          // The stop worked. Putting the queue back is its own step with its own failure: it
          // must never be taken for a stop that did not arrive (Retry, back to "running").
          try {
            restoreStoppedQueue(get, sessionId, result.returned)
          } catch (error) {
            toast.error('Could not put your queued messages back', {
              description: errorMessage(error, '') || undefined,
            })
          }
        },
        (error: unknown) => {
          // A Stop that never reached the server was silent: the button flipped back and the agent
          // kept working, with nothing saying why. The person pressed it, so they hear it failed.
          toast.error('Could not stop the agent', {
            description: errorMessage(error, '') || undefined,
            action: { label: 'Retry', onClick: () => get().stopGeneration(sessionId) },
          })
          // A transport failure says nothing about server state. Restore the
          // conservative running edge only if no stream event replaced our
          // optimistic stop in the meantime, then reconcile authoritatively.
          const state = get()
          if (wasRunning && findSessionInState(state, sessionId) === optimisticStop) {
            state._setSessionRunning(sessionId, true)
          }
          const beforeFetch = findSessionInState(get(), sessionId)
          void backendClient
            .getSession(sessionId)
            .then((session) => {
              if (findSessionInState(get(), sessionId) === beforeFetch) applyServerSession(session)
            })
            .catch(() => {})
        },
      )
    },
  }
}
