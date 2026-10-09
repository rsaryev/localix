import type { AgentStreamEvent } from '@/shared/api/contracts'
import { autoReveal } from '@/shared/lib/inspectorBus'
import { pickDocumentPaths } from '@/shared/lib/contentTypeRouting'
import { openPolicy } from '@/shared/lib/workspaceOf'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { decideFollowReveal } from './followAgentEdits'
import { useChatStore } from './store'

// Histories retain creation order: a read or replay must not refresh a session.
function sessionPaths(history: Map<string, Set<string>>, sessionId: string): Set<string> {
  let seen = history.get(sessionId)
  if (!seen) {
    seen = new Set<string>()
    history.set(sessionId, seen)
    if (history.size > 500) {
      const oldest = history.keys().next().value
      if (oldest && oldest !== sessionId) history.delete(oldest)
    }
  }
  return seen
}

// Document files (pdf/office/csv/xlsx) already auto-opened per session — so a
// re-write of the same file (or an fs.changed replay) doesn't re-pop its viewer.
// Capped like the other per-session guards so a long-lived tab can't grow it
// unbounded.
const openedDocuments = new Map<string, Set<string>>()
// Bound the auto-opens per session — a pathological build that emits dozens of
// spreadsheets shouldn't bury the workspace in tabs.
const MAX_AUTO_OPENED_DOCS = 12

/**
 * Auto-open agent-PRODUCED documents. The fs-watch `fs.changed` event carries the
 * absolute paths that changed under the session's workspace (files AND their parent
 * directories); `pickDocumentPaths` keeps only the ones with a dedicated viewer
 * (pdf/docx/odt/pptx/xlsx/csv). Each such file, the FIRST time it appears, pops its
 * viewer tab (PDF/Document/Table) through the shared auto-reveal seam — decoupling
 * "the agent produced a file" from "the app surfaced it" without a bespoke tool.
 *
 * Gated to the ACTIVE session only: a background worker/sub-agent producing files
 * must not steal the workspace the user is looking at; the reveal names the event's
 * session, so the tab opens in that chat's grid. Server-side debounced (250ms) + a per-session
 * seen-set makes replay-on-reconnect and repeated writes idempotent.
 */
export function routeFsDocumentsOpened(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  // Opening a document takes focus, so only the conversation on screen may (`openPolicy`).
  if (openPolicy(useChatStore.getState().activeSessionId, sessionId) !== 'focus') return
  const docs = pickDocumentPaths(parsed.paths)
  if (docs.length === 0) return
  const seen = sessionPaths(openedDocuments, sessionId)
  for (const path of docs) {
    if (seen.has(path) || seen.size >= MAX_AUTO_OPENED_DOCS) continue
    seen.add(path)
    // `important: true` mirrors the preview/table/review auto-opens — surface the
    // produced artifact even into a closed panel. Lands in the editor grid area, not
    // over the chat, so it never hides the conversation.
    autoReveal({ kind: 'file', sessionId, path }, { important: true })
  }
}

// Code files already gently revealed per session under "Follow the agent's edits",
// so a re-write of the same file (or an fs.changed replay on reconnect) doesn't
// re-reveal it. Capped like the sibling document guard so a long-lived tab can't
// grow it unbounded.
const followedEdits = new Map<string, Set<string>>()
const MAX_FOLLOWED_EDITS = 12

/**
 * "Follow the agent's edits" — OPT-IN, default OFF.
 * Sibling to {@link routeFsDocumentsOpened} off the SAME `fs.changed` event: when the
 * `agentSettings.followAgentEdits` toggle is on, gently reveal the most-recent NORMAL
 * code/text file the ACTIVE session's agent just wrote so the user can watch it work.
 *
 * A COMPLETE no-op when the setting is off → zero behavior change from today. Reuses
 * the doc router's guards: ACTIVE session only (a background worker/sub-agent must
 * not steal the workspace) + a per-session seen-set + cap (never re-reveal the same
 * file, idempotent on replay/reconnect). Unlike the document auto-open, this reveal
 * is GENTLE (no `important`): it lands in the editor grid area only when a panel is
 * already open and never pops over the chat or a closed panel — following, not
 * yanking. `pickCodeEditablePaths` excludes directories, dotfiles, the viewer-doc
 * types the sibling router owns, and binaries, so the two never fight over a file.
 */
export function routeFollowAgentEdits(
  sessionId: string,
  parsed: Extract<AgentStreamEvent, { type: 'fs.changed' }>,
): void {
  const enabled =
    useUserSettings.getState().settings.agentSettings?.followAgentEdits?.enabled ?? false
  if (!enabled) return
  const isActiveSession = openPolicy(useChatStore.getState().activeSessionId, sessionId) === 'focus'
  const seen = sessionPaths(followedEdits, sessionId)
  const target = decideFollowReveal({
    enabled,
    isActiveSession,
    paths: parsed.paths,
    seen,
    maxOpened: MAX_FOLLOWED_EDITS,
  })
  if (!target) return
  seen.add(target)
  // Gentle: no `important`, so a `file` reveal only lands when the editor grid is
  // already open (it never opens a closed panel or hides the conversation).
  autoReveal({ kind: 'file', sessionId, path: target })
}
