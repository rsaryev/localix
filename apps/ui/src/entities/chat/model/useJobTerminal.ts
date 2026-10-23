import { useCallback } from 'react'
import type { CommandItem } from '@localixai/agent/agents'
import { isCommandItem } from '@localixai/agent/agents/items'
import type { UiSession } from '@/shared/api/contracts'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useChatStore } from './store'

/**
 * Find the live bash `CommandItem` for a background job by its tool-call id, WITH the session whose
 * transcript holds it.
 *
 * The owner travels with the item because the job's terminal tab belongs to that session: it was
 * stamped with whichever chat was on screen, so revealing a job from a background chat (the
 * sidebar, the runtime panel) opened its pane in another chat's workspace.
 */
function findCommandItem(
  sessions: UiSession[],
  toolCallId: string,
): { item: CommandItem; sessionId: string } | null {
  for (const session of sessions) {
    for (const message of session.messages) {
      for (const item of message.items ?? []) {
        if (isCommandItem(item) && item.toolCallId === toolCallId) {
          return { item, sessionId: session.id }
        }
      }
    }
  }
  return null
}

/**
 * Background jobs are surfaced in several places (command card, runtime panel,
 * the runtime panel, command cards, and the sidebar). Clicking any of them should reveal the job's live
 * PTY terminal pane — never a read-only sub-session. This hook centralizes that
 * routing so every surface shares one implementation.
 *
 * Reads store state lazily via `getState()` at click time, so the returned
 * callbacks are stable and add no streaming-path subscription overhead.
 */
export function useJobTerminal() {
  /** Reveal the terminal pane for a background job identified by its bash tool-call id. */
  const openJobTerminal = useCallback((sourceToolCallId: string) => {
    const found = findCommandItem(useChatStore.getState().allSessions, sourceToolCallId)
    if (found?.item.terminalId) {
      terminalBus.openJob({
        terminalId: found.item.terminalId,
        sessionId: found.sessionId,
        title: found.item.command || 'Task',
      })
    }
  }, [])

  /**
   * If `sessionId` is a job session with a live terminal, reveal it and return
   * true; otherwise return false so the caller can fall back to its normal
   * navigation (e.g. open the chat for a sub-agent, or for a job with no PTY).
   */
  const openIfJobSession = useCallback(revealJobSession, [])

  return { openJobTerminal, openIfJobSession }
}

/** Imperative counterpart used by the app-level mini app runtime adapter. */
export function revealJobSession(sessionId: string): boolean {
  const { allSessions } = useChatStore.getState()
  const target = allSessions.find((session) => session.id === sessionId)
  if (target?.sessionKind !== 'job' || !target.sourceToolCallId) return false
  const found = findCommandItem(allSessions, target.sourceToolCallId)
  if (!found?.item.terminalId) return false
  terminalBus.openJob({
    terminalId: found.item.terminalId,
    sessionId: found.sessionId,
    title: found.item.command || 'Task',
  })
  return true
}
