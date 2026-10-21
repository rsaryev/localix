/**
 * Paint the previous launch's shell before the first render, not after the first answers.
 *
 * Runs synchronously from `main.tsx`, ahead of `createRoot`, so React's very first commit
 * already has a session roster and a capability set. Everything the network then returns
 * is a CONFIRMATION of a frame the user is already looking at: identical in the common
 * case (no re-render), a small correction otherwise. What it is not is the reveal it used
 * to be — an empty sidebar and an empty rail filling in over the first second and a half.
 *
 * Deliberately routed through `hydrateWorkspace`, the same entry point the network path
 * uses, rather than a second "restore" path into the store. Restoring is not a different
 * kind of hydration and must not be able to drift into one.
 */

import { createWorkspaceSnapshot } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { uiSessionSummary } from '@/shared/api/session-summary'
import { restorePluginContribFrame } from '@/shared/contrib/enabledPlugins'
import { readShellSnapshot } from '@/shared/lib/shellSnapshot'

import { loadLastWorkspace } from './persistence'
import { useChatStore } from './store'

/** True when a frame was restored — i.e. this is not the user's first ever launch. */
export function restoreShellFrame(): boolean {
  // One atomic read of the launch-restore pair — the same record the URL sync's launch
  // restore navigates to. Reading the scope and the chat from two independent keys let the
  // painted frame and the restored route disagree; here they cannot.
  const remembered = loadLastWorkspace()
  // No remembered scope means there is no frame to repaint: a scope IS a project, and the
  // record is only written once one has been entered.
  if (!remembered) return false
  const { projectId } = remembered
  const snapshot = readShellSnapshot<UiSession>(projectId)
  if (!snapshot) return false

  if (snapshot.capabilities) restorePluginContribFrame(projectId, snapshot.capabilities)
  if (snapshot.sessions.length === 0) return snapshot.capabilities !== null

  // The scope has to be in place before hydration: the roster is filtered by it, and a
  // hydrate against an unresolved scope would paint an empty list over a real one.
  useChatStore.setState({ activeProjectId: projectId })
  // Projected again on the way IN, so no record — one written before the projection existed,
  // or by any future writer — can paint a body as loaded: a restored row is a summary, and the
  // open chat fetches its detail exactly as on a first launch.
  useChatStore
    .getState()
    .hydrateWorkspace(
      createWorkspaceSnapshot(snapshot.sessions.map(uiSessionSummary), remembered.sessionId),
    )
  return true
}
