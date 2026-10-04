/**
 * EVENT CENTER → THE PLAN TAB.
 *
 * A journal row for a presented plan names its resource (`kind: 'plan'`, id = the plan id), and
 * the Event Center's "Review plan" navigates to the row's chat and asks for that resource. With
 * no owner for the `plan` kind the request was never consumed: the person landed in the chat and
 * had to find the strip or the tool card to open the very plan the row was about.
 *
 * The request survives navigation (`eventFocusBus.ts`), so this consumes it only once its chat is
 * the one on screen — the same routing the terminal deep link uses (`useTerminalBusWiring.ts`) —
 * and opens the plan tab on that version.
 */
import { useEffect } from 'react'

import { useEventFocusStore, type EventFocusRequest } from '@/shared/lib/eventFocusBus'
import { findSessionInState } from './findSession'
import { openPlanTab } from './plans'
import { useChatStore } from './store'

/** The plan to open for a pending request, or null when it is not a plan or not this chat's. */
export function planEventFocusTarget(
  request: EventFocusRequest | null,
  activeSessionId: string | null,
): { sessionId: string; planId: string } | null {
  return request?.resourceKind === 'plan' && request.sessionId === activeSessionId
    ? { sessionId: request.sessionId, planId: request.resourceId }
    : null
}

export function usePlanEventFocus(activeSessionId: string | null): void {
  useEffect(() => {
    const revealPending = () => {
      const focus = useEventFocusStore.getState()
      const target = planEventFocusTarget(focus.pending, activeSessionId)
      if (!target || !focus.pending) return
      // Plans belong to the ROOT session; a row from a delegated child still opens its root's.
      const session = findSessionInState(useChatStore.getState(), target.sessionId)
      openPlanTab({
        sessionId: target.sessionId,
        ownerId: session?.rootSessionId ?? target.sessionId,
        planId: target.planId,
      })
      const token = focus.pending.token
      focus.consume(token)
      focus.clearActive(token)
    }
    revealPending()
    return useEventFocusStore.subscribe((state, previous) => {
      if (state.sequence !== previous.sequence) revealPending()
    })
  }, [activeSessionId])
}
