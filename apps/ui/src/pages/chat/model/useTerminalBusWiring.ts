import { useEffect } from 'react'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import {
  revealOrCreateTerminal,
  adoptTerminal,
  revealTerminal,
} from '@/features/terminal/model/terminalTabs'
import { useEventFocusStore, type EventFocusRequest } from '@/shared/lib/eventFocusBus'

export function terminalEventFocusTarget(
  request: EventFocusRequest | null,
  activeSessionId: string | null,
): { terminalId: string; sessionId: string } | null {
  return request?.resourceKind === 'terminal' && request.sessionId === activeSessionId
    ? { terminalId: request.resourceId, sessionId: request.sessionId }
    : null
}

/**
 * Wires the terminalBus openers to the grid's terminal tabs, so transcript code
 * blocks and agent background jobs drive terminals consistently. Each terminal is
 * a first-class grid WorkItem (see terminalTabs) — there's no separate manager, so
 * a deleted session's terminals are freed by the grid's closeScope, and reload
 * restores them by reattaching the restored tabs to their surviving backend PTYs.
 */
export function useTerminalBusWiring(opts: { activeSessionId: string | null }): void {
  const { activeSessionId } = opts

  // Let transcript code blocks reveal a terminal (terminalBus.run → open/focus one) — in the chat
  // the block belongs to, which the bus names. Revealing the ACTIVE chat's terminal opened a pane
  // in a chat the command was never meant for.
  useEffect(() => terminalBus.setOpener((sessionId) => revealOrCreateTerminal(sessionId)), [])

  // Agent background jobs run in a PTY: when someone opens one (its strip row, its card, a plugin),
  // reveal a terminal tab attached to the job's backend terminal (adopted — closing the tab leaves
  // the job running), in the job's own chat. Nothing calls this on the job's own events.
  useEffect(() => terminalBus.setJobOpener(adoptTerminal), [])

  // Event Center resource deep-link → exact PTY. The request survives navigation;
  // when the destination session becomes active this feature consumes only the
  // resource kind it owns, leaving all future resource kinds domain-agnostic. Waiting for the
  // OPEN chat is routing here, not ownership: the request names its session, and the pane is
  // revealed once that session is the one on screen.
  useEffect(() => {
    const revealPending = () => {
      const focus = useEventFocusStore.getState()
      const target = terminalEventFocusTarget(focus.pending, activeSessionId)
      if (!target || !focus.pending) return
      revealTerminal(target)
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
