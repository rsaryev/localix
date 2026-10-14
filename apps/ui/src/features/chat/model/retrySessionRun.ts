import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { useChatStore } from './store'
import { findSessionInState } from './findSession'

/**
 * How a retry ended. `superseded` / `no_reply` are the server REFUSING because the reply the caller
 * named is not the one a regenerate would rewrite — an answer, not a failure, so the caller words it.
 */
export type RetryOutcome = 'accepted' | 'failed' | 'superseded' | 'no_reply'

const REFUSALS: Record<string, RetryOutcome> = {
  regenerate_superseded: 'superseded',
  regenerate_no_reply: 'no_reply',
}

/**
 * One safe owner for notification/toast retries. A failed preflight or network
 * request must not leave the optimistic running flag stuck forever.
 */
export async function retrySessionRun(
  sessionId: string,
  projectId: string | null,
  /** The reply this retry is for; the server refuses if a newer one came after it. */
  expectedMessageId?: string,
): Promise<RetryOutcome> {
  useChatStore.getState()._setSessionRunning(sessionId, true)
  const optimistic = findSessionInState(useChatStore.getState(), sessionId)
  try {
    await backendClient.regenerate(sessionId, projectId, expectedMessageId)
    return 'accepted'
  } catch (error) {
    // A failed HTTP response can arrive after WebSocket events from an accepted run.
    // Do not roll that newer state back with our optimistic failure or a stale GET.
    if (findSessionInState(useChatStore.getState(), sessionId) === optimistic)
      useChatStore.getState()._setSessionRunning(sessionId, false)
    const beforeSnapshot = findSessionInState(useChatStore.getState(), sessionId)
    void backendClient
      .getSession(sessionId)
      .then((session) => {
        if (
          beforeSnapshot &&
          session.id === sessionId &&
          findSessionInState(useChatStore.getState(), sessionId) === beforeSnapshot
        )
          useChatStore.getState()._replaceSession(session)
      })
      .catch(() => undefined)
    const refusal = error instanceof ApiError && error.code ? REFUSALS[error.code] : undefined
    if (refusal) return refusal
    // Filed under the chat it retried, not under whatever happens to be on screen when it fails.
    toast.error('Could not retry the agent run', {
      description: errorMessage(error, '') || undefined,
      origin: { kind: 'session', sessionId, projectId },
    })
    return 'failed'
  }
}
