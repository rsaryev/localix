import type { AgentItem } from '@localixai/agent/agents'
import type { EventFocusRequest } from '@/shared/lib/eventFocusBus'
import { useEventFocusStore } from '@/shared/lib/eventFocusBus'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'

const TOOL_RESOURCE_KINDS = new Set(['tool', 'interaction'])

/**
 * Match a domain-agnostic Event Center resource to the transcript tool that owns it.
 * Interaction ids are commonly a stable prefix of the concrete call id, so the
 * existing prefix contract is preserved without teaching the notification layer
 * about any tool implementation.
 */
export function eventFocusTargetsTool(
  request: EventFocusRequest | null,
  sessionId: string | null,
  item: AgentItem,
): boolean {
  if (
    !request ||
    !sessionId ||
    request.sessionId !== sessionId ||
    !TOOL_RESOURCE_KINDS.has(request.resourceKind) ||
    !('toolCallId' in item) ||
    typeof item.toolCallId !== 'string'
  ) {
    return false
  }
  return item.toolCallId.startsWith(request.resourceId)
}

export function eventFocusTargetsAnyTool(
  request: EventFocusRequest | null,
  sessionId: string | null,
  items: readonly AgentItem[],
): boolean {
  return items.some((item) => eventFocusTargetsTool(request, sessionId, item))
}

/** True only while this mounted tool set is the Event Center's visible reveal target. */
export function useToolEventFocus(items: readonly AgentItem[]): EventFocusRequest | null {
  const workItemVisible = useWorkItemVisible()
  // The transcript's own session: a tool set outside one is never an Event Center target.
  const sessionId = useWorkItemSessionId()
  return useEventFocusStore((state) =>
    workItemVisible && eventFocusTargetsAnyTool(state.active, sessionId, items)
      ? state.active
      : null,
  )
}
