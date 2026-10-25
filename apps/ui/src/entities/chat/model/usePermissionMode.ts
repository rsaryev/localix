import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import type { ImplementationMode, SessionPlan } from '@localixai/api/client'
import { DEFAULT_PERMISSION_MODE, type PermissionMode } from '@localixai/api/permission-modes'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { findSessionInState } from './findSession'
import { latestPresentedPlan, usePlanList, usePlanOwnerId, usePlansLoaded } from './plans'
import { useChatStore } from './store'
import { usePlanDecisions } from './usePlanDecisions'

/**
 * The composer's view of its conversation's permission mode, and the one way to change it.
 *
 * A delegated child runs under its root's mode and the server refuses to set one on it, so the
 * control is read-only there (`editable: false`) rather than offering a change that 409s.
 *
 * It also carries the plan WAITING in Plan mode, because leaving Plan mode sets that plan aside:
 * a person who picked Default to start the work found the Approve button gone and the plan
 * dismissed. With `waitingPlan` set the control asks instead — approve it in that mode
 * (`approvePlan`), or leave and set it aside (`setMode`, which dismisses as before).
 */
export function usePermissionMode(sessionId: string | null) {
  const mode =
    useChatStore((state) => findSessionInState(state, sessionId)?.permissionMode) ??
    DEFAULT_PERMISSION_MODE
  const editable = useChatStore((state) => {
    const session = findSessionInState(state, sessionId)
    return Boolean(session) && !session?.parentSessionId
  })
  const ownerId = usePlanOwnerId(sessionId)
  usePlansLoaded(editable ? ownerId : null)
  const plans = usePlanList(ownerId)
  const waitingPlan: SessionPlan | undefined =
    mode === 'plan' ? latestPresentedPlan(plans) : undefined
  const { approve } = usePlanDecisions(ownerId)

  // Resolves once the server has the new mode (false when it refused), so a caller that acts in
  // the new mode — `/plan <task>` sends the task — does not race the change.
  const setMode = useCallback(
    async (permissionMode: PermissionMode): Promise<boolean> => {
      if (!sessionId) return false
      try {
        // The server publishes the stored session as `session.updated`; the stream applies it.
        await backendClient.updateSession(sessionId, { permissionMode })
        return true
      } catch (err: unknown) {
        toast.error('Could not change the permission mode', {
          description: errorMessage(err, '') || undefined,
        })
        return false
      }
    },
    [sessionId],
  )

  // The quick path approves with the popover's default addressee, "Any agent": no `to`, so the
  // conversation's strategy picks who answers, as for a message with no @mention.
  const approvePlan = (implementation: ImplementationMode) => {
    if (waitingPlan) void approve(waitingPlan, implementation)
  }

  return { mode, editable, setMode, waitingPlan, approvePlan }
}
