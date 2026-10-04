import { scopeKindOf } from '@/features/workspace-grid/model'
import { inspector, type OpenWorkItemRequest } from '@/shared/lib/inspectorBus'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'

/**
 * Open a view tab from a PAGE-level command (a rail button, a palette entry) in the chat the page
 * has open.
 *
 * The defect this stops: these opens named no chat, so the grid used to stamp the tab with
 * whichever chat was focused — and now that every session kind needs its chat named, they would
 * be refused silently. A page command acts on the open chat, given here explicitly; an app-level
 * kind belongs to no chat and needs none; a session kind with no chat open says so and opens
 * nothing.
 */
export function openPageWorkItem(
  openSessionId: string | null,
  request: Omit<OpenWorkItemRequest, 'scope'>,
): void {
  if (scopeKindOf(request.workKind) === 'global') {
    inspector.openWorkItem({ ...request, scope: null })
    return
  }
  const sessionId = requireOpenChat(openSessionId)
  if (sessionId) inspector.openWorkItem({ ...request, scope: sessionId })
}
