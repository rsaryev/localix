// The previews' side of the session stream: what a preview frame does to the Browser.
import type { AgentStreamEvent } from '@/shared/api/contracts'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import type { SessionPreviews } from '@/shared/lib/sessionPreviews'
import { originOf } from '@/shared/lib/url'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { noteAgentActivity } from './agentPageCleanup'
import { closeNativePages } from './nativePages'
import { openPreviewFromClick } from './openPreview'
import { previewHostKey, usePreviewHosts } from './previewHosts'
import { usePreviewStore } from './previewStore'
import { revealPreview } from './revealPreview'

/**
 * Agent-driven preview control: relay the `browser` command to the open
 * PreviewTab via the bus (not the store — it's a transient request). The tab runs
 * it against the probe and replies over the `preview-result` WS RPC.
 */
export function routePreviewCommand(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.command' }>,
): void {
  // A command to a tab whose renderer was released brings it back off screen to answer.
  if (parsed.command.previewId) {
    usePreviewHosts.getState().opened(previewHostKey(sessionId, parsed.command.previewId))
    noteAgentActivity(parsed.command.previewId)
  }
  previewControlBus.publish({ sessionId, commandId: parsed.commandId, command: parsed.command })
}

/**
 * Agent closed the preview (`browser action="close"`): close the session's
 * preview tab(s) via the inspector bus. Not gated on the panel being open (closing a
 * tab can't steal focus) and not routed through the store — the preview lives in the
 * inspector. With no `previewId`, the tabs the session itself opened close.
 */
export function routePreviewClosed(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.closed' }>,
): void {
  // Clear the session's preview CONTENT — only in its workspace's Browser strip. Each workspace
  // has its own; scanning every strip let an agent close another chat's pages. The strip is
  // shared with the sub-sessions of that workspace, so a close that names no tab reaches only
  // what THIS session opened: a finished sub-agent's cleanup must not take its parent's pages.
  const previewStore = usePreviewStore.getState()
  const requested = parsed.previewIds ? new Set(parsed.previewIds) : null
  const closing: string[] = []
  for (const entry of previewStore.previewTabsBySession[workspaceOf(sessionId)] ?? []) {
    if (
      requested
        ? !requested.has(entry.previewId)
        : parsed.previewId
          ? entry.previewId !== parsed.previewId
          : entry.originSessionId !== sessionId
    )
      continue
    if (parsed.backgroundOnly && entry.userOpened) continue
    closing.push(entry.previewId)
  }
  if (closing.length) {
    previewStore.closeBrowserTabs(closing)
    closeNativePages(closing, 'Could not close the pages the agent opened')
  }
  // Closing an agent page does not close the chat's Browser tab itself.
}

/**
 * Open (or refresh) a live server preview in the inspector panel. The recording, the version
 * guard and the reveal live in `revealPreview`, shared with the click path that opens a preview
 * from a response — see that module for why the frame alone was not enough.
 */
export function routePreviewUpdated(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'preview.updated' }>,
): void {
  noteAgentActivity(parsed.previewId ?? originOf(parsed.url))
  revealPreview(sessionId, {
    background: parsed.background,
    viewport: parsed.viewport,
    agentViewport: parsed.viewport ? true : undefined,
    previewId: parsed.previewId ?? originOf(parsed.url),
    url: parsed.url,
    title: parsed.title,
    version: parsed.version,
    servedFile: parsed.servedFile,
    rootDir: parsed.rootDir,
    frameBlocked: parsed.frameBlocked,
  })
}

/** Close the pages of deleted conversations and drop their previews. */
export function forgetSessionPreviews(sessionIds: readonly string[]): void {
  const previews = usePreviewStore.getState()
  for (const id of sessionIds) {
    closeNativePages(
      (previews.previewTabsBySession[id] ?? []).map((entry) => entry.previewId),
      'Could not close the pages of the deleted chat',
    )
    previews.discardSessionPreview(id)
  }
}

/** The inspector's implementation of the port the chat feature talks to. */
export const inspectorSessionPreviews: SessionPreviews = {
  updated: routePreviewUpdated,
  command: routePreviewCommand,
  closed: routePreviewClosed,
  forget: forgetSessionPreviews,
  open: openPreviewFromClick,
}
