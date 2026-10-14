/**
 * WHERE THE PERSON IS — one owner for every record of it.
 *
 * The open chat used to be written down by nine call sites across the store: hydration, project
 * selection, session selection, creation, deletion, each into its own key, each at its own moment
 * — often before the URL had moved there, and sometimes for a chat the person never saw (a draft
 * resolved after they left, a roster default). The desktop shell kept a fifth copy that reached
 * disk only on a clean quit. The records drifted apart, and a relaunch reopened whichever one
 * happened to win.
 *
 * Now the URL is the only live answer, and this ledger is the only writer: it follows the router,
 * and each settled chat route `/project/<p>/<s>` updates, together,
 *
 *   - the launch-restore pair (`localix_last_workspace`) a cold launch reopens,
 *   - the project's remembered chat, which a project switch returns to,
 *   - the active project key, and
 *   - this window's route in the desktop shell, which saves it to disk at once.
 *
 * Every other module only reads these records, or invalidates one that is confirmed dead
 * (`forgetSessionLocation`, `forgetLastWorkspace`).
 */
import { matchPath } from 'react-router'

import { ROUTE_PATTERNS } from '@/shared/routing/routes'
import { reportWorkspaceRoute, type WorkspaceRouteSource } from '@/shared/lib/workspaceWindow'
import { recordChatLocation } from './persistence'

/** The chat a pathname shows, or `null` for any route that is not one open chat. */
export function chatLocationOf(pathname: string): { projectId: string; sessionId: string } | null {
  const match = matchPath(`/${ROUTE_PATTERNS.projectChat}`, pathname)
  const projectId = match?.params.projectId
  const sessionId = match?.params.sessionId
  return projectId && sessionId ? { projectId, sessionId } : null
}

/** Follow the router for the life of the window; returns the unsubscribe. */
export function installLocationLedger(router: WorkspaceRouteSource): () => void {
  let recorded: string | null = null
  const record = (pathname: string) => {
    reportWorkspaceRoute(pathname)
    const chat = chatLocationOf(pathname)
    if (!chat) return
    const key = `${chat.projectId}/${chat.sessionId}`
    if (key === recorded) return
    recorded = key
    recordChatLocation(chat.projectId, chat.sessionId)
  }
  const onHashChange = () => record((window.location.hash.slice(1) || '/').split('?')[0] || '/')
  window.addEventListener('hashchange', onHashChange)
  const unsubscribe = router.subscribe((state) => record(state.location.pathname))
  record(router.state.location.pathname)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
    unsubscribe()
  }
}
