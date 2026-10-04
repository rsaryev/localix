import type { UiNavigationAction, UiNavigationRequest } from '@localixai/plugin-sdk/ui'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { subscribeUiCommands, uiCommandRevision } from '@/shared/contrib/uiCommands'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { navigateUiAction, viewUiNavigationAction } from '@/shared/lib/uiNavigation'

const AUTO_NAVIGATION_MAX_AGE_MS = 60_000
const autoNavigationMemory = new Set<string>()

/** The manual action a request stands for — the same destination, without the one-shot reveal. */
export function navigationRequestAction(request: UiNavigationRequest): UiNavigationAction {
  return {
    type: 'ui.navigate',
    uri: request.uri,
    label: request.label,
    ...(request.description ? { description: request.description } : {}),
  }
}

function autoNavigationKey(toolCallId: string): string {
  return `localix:auto-navigation:${toolCallId}`
}

function wasAutoNavigated(toolCallId: string): boolean {
  if (autoNavigationMemory.has(toolCallId)) return true
  try {
    return sessionStorage.getItem(autoNavigationKey(toolCallId)) === '1'
  } catch {
    return false
  }
}

function rememberAutoNavigation(toolCallId: string): void {
  autoNavigationMemory.add(toolCallId)
  try {
    sessionStorage.setItem(autoNavigationKey(toolCallId), '1')
  } catch {
    // Storage can be unavailable in hardened webviews; the in-memory guard still
    // prevents React remounts from replaying a completed tool's UI side effect.
  }
}

/**
 * Reveal a tool's FRESH navigation request once — the one place that decides it.
 *
 * A tool that asks the UI to open something (`ui.navigate.request`) expects it opened when the
 * call lands, and never again: not when the transcript remounts, not when the chat is reopened
 * tomorrow, not in a second window. Each card that renders such an output used to be the one
 * deciding, so a card that forgot the age window replayed a stale request on every reload, and a
 * card that forgot the memory reopened the tab on every re-render. So the rule lives here:
 *
 * - only a request issued within the last minute (a small clock skew tolerated) is revealed;
 * - only while its destination is available — a location or command that has not registered yet
 *   is retried when its registry revision moves, not dropped;
 * - once per tool call, remembered in memory and in `sessionStorage`.
 */
export function useToolNavigationRequest(
  toolCallId: string,
  request: UiNavigationRequest | undefined,
): void {
  const locationRevision = useSyncExternalStore(
    subscribeUiLocations,
    uiLocationRevision,
    uiLocationRevision,
  )
  const commandRevision = useSyncExternalStore(
    subscribeUiCommands,
    uiCommandRevision,
    uiCommandRevision,
  )
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  const action = useMemo(() => (request ? navigationRequestAction(request) : null), [request])
  const available = useMemo(
    () => (action ? viewUiNavigationAction(action).available : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revisions stand in for the registries
    [action, locationRevision, commandRevision],
  )

  useEffect(() => {
    if (!request || !action || !available) return
    const age = Date.now() - request.issuedAt
    if (age < -5_000 || age > AUTO_NAVIGATION_MAX_AGE_MS) return
    if (wasAutoNavigated(toolCallId)) return
    if (navigateUiAction(action, navigation)) rememberAutoNavigation(toolCallId)
  }, [action, available, navigation, request, toolCallId])
}
