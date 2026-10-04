import { autoReveal } from '@/shared/lib/inspectorBus'
import { useChatStore } from '@/features/chat/model/store'
import { openPolicy } from '@/shared/lib/workspaceOf'
import { usePreviewStore } from './previewStore'
import type { PreviewEntry } from './preview'
import { previewHostKey, usePreviewHosts } from './previewHosts'

/**
 * Record an opened preview and reveal its tab — from EITHER the `preview.updated` stream frame or
 * the response of `POST /rpc/preview/open`.
 *
 * The response gives an immediate reveal to its caller; the replayable roster frame also
 * reaches background child conversations without a mounted chat surface. Both may arrive
 * for the same open operation, so the version guard prevents duplicate reveals. Background
 * opens record a live host without stealing the user's active tab.
 */

// Last version applied per `${sessionId}:${previewId}`. Makes the frame and the response
// idempotent against each other, and SSE replay on reconnect idempotent against both.
const appliedVersions = new Map<string, number>()

export function revealPreview(sessionId: string, entry: PreviewEntry): void {
  const key = `${sessionId}:${entry.previewId}`
  // Cap the map so a long-lived tab cannot accumulate entries for every preview ever opened.
  if (appliedVersions.size > 500) appliedVersions.clear()
  if (appliedVersions.get(key) === entry.version) return
  appliedVersions.set(key, entry.version)
  // Record the preview CONTENT (active entry + mini-browser tab + history) so the Preview
  // work item's body has something to show; the grid only owns the TAB.
  usePreviewStore.getState().recordPreview(sessionId, entry)
  usePreviewHosts.getState().opened(previewHostKey(sessionId, entry.previewId))
  if (entry.background) return
  // An on-screen gate, not an owner lookup: the Browser tab is this chat's own (the request below
  // names it), but revealing it while another chat is open would pull the person out of the chat
  // they are reading. A background chat's preview is recorded above and waits for its chat; one a
  // sibling conversation of this workspace opened is in the shared Browser strip already, and does
  // not take focus either (`openPolicy`).
  if (openPolicy(useChatStore.getState().activeSessionId, sessionId) !== 'focus') return
  // A live preview coming up is an `important` reveal — it may open a closed panel (unlike a
  // file reveal, which only lands when already open). Routed through the shared policy
  // so the focus-stealing rule stays defined in one place.
  autoReveal(
    {
      kind: 'preview',
      url: entry.url,
      title: entry.title,
      version: entry.version,
      sessionId,
      previewId: entry.previewId,
      servedFile: entry.servedFile,
      rootDir: entry.rootDir,
      startCommand: entry.startCommand,
      frameBlocked: entry.frameBlocked,
    },
    { important: true },
  )
}
