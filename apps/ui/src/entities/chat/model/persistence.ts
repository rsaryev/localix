import { workspaceStorageKey } from '@/shared/lib/workspaceWindow'
// localStorage-backed UI preferences for the chat workspace. Each accessor
// swallows storage failures (private-mode/quota/disabled) and degrades to a
// null read or a no-op write so the store never throws on a flaky storage.

import { loadJSON, loadString, saveJSON, saveString } from '@localixai/mini-app-sdk/ui/storage'

/**
 * NO SERVER-OWNED IDENTIFIER IS KEPT HERE.
 *
 * `localix_last_model` and `localix_last_connection` used to live in this file: the model and
 * the provider connection a new chat should start on. Both are rows in the database, and
 * localStorage outlives the database — deleting `~/.localix/localix.db` left the browser
 * confidently sending a `providerConnectionId` for a connection that no longer existed, and
 * creating a group answered 500. Every read site had to re-check the id against the live
 * connection list, one of them forgot, and that is the defect: a rule enforced at each caller
 * is a rule that will be missed.
 *
 * The answer already existed on the server. "The route you last chose" is the `recent` level of
 * the model chain, read from the seats of real conversations
 * (`apps/api/src/features/chat/repository-recent-routes.ts`), and "the model chats start on" is
 * the project's own setting. A browser copy of either is a second answer that drifts from the
 * first and survives the data it describes.
 *
 * What stays is what the browser genuinely owns: where you were (scope and chat), your composer
 * history.
 * A stale scope or chat id is already handled: the launch restore verifies the pair and
 * `forgetLastWorkspace` drops it when it is confirmed dead.
 */
const ACTIVE_SESSION_KEY = workspaceStorageKey('localix_active_session_id')
const LAST_WORKSPACE_KEY = workspaceStorageKey('localix_last_workspace')
const PROMPT_HISTORY_KEY = 'localix_prompt_history'
const PROMPT_HISTORY_LIMIT = 150

const activeSessionKey = (projectId?: string | null) =>
  projectId ? `${ACTIVE_SESSION_KEY}_${projectId}` : ACTIVE_SESSION_KEY

/**
 * Record the open chat: the project's remembered chat and the launch-restore pair, together. Called ONLY by the location ledger (`locationLedger.ts`), which follows the URL
 * — the store never writes where the person is, so these records cannot drift from what they see.
 */
export function recordChatLocation(projectId: string, sessionId: string) {
  saveString(activeSessionKey(projectId), sessionId)
  // One JSON value, so two windows racing each write a whole pair and never a torn one.
  rememberLastWorkspace(projectId, sessionId)
}

/** A chat is gone: drop every record that still points at it. */
export function forgetSessionLocation(projectId: string | null, sessionId: string) {
  if (projectId && loadString(activeSessionKey(projectId)) === sessionId) {
    saveString(activeSessionKey(projectId), null)
  }
  const last = loadLastWorkspace()
  if (last?.sessionId === sessionId) {
    saveJSON(LAST_WORKSPACE_KEY, { projectId: last.projectId, sessionId: null })
  }
}

export function loadRememberedActiveSession(projectId?: string | null): string | null {
  return loadString(activeSessionKey(projectId))
}

/** Global, cross-session composer history — newest first, capped. */
export function loadPromptHistory(): string[] {
  const raw = loadJSON<unknown>(PROMPT_HISTORY_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

/** Record a sent prompt at the front of the global history (dedup + cap). */
export function appendPromptHistory(prompt: string): void {
  const text = prompt.trim()
  if (!text) return
  const next = [text, ...loadPromptHistory().filter((p) => p !== text)].slice(
    0,
    PROMPT_HISTORY_LIMIT,
  )
  saveJSON(PROMPT_HISTORY_KEY, next)
}

/**
 * The scope + chat the user was last actually in — the record a cold launch reopens from.
 *
 * WHY A SECOND RECORD. The per-scope `localix_active_session_id_*` keys remember each scope's
 * chat for round-trips inside a running window (`selectProject`); they do not say WHICH scope a
 * cold launch reopens. One atomic value does, and cannot be torn across windows.
 */
export interface LastWorkspace {
  /** The scope — always a project; there is no project-less one. */
  projectId: string
  /** The scope's last active chat, or `null` when it had none. */
  sessionId: string | null
}

let lastWorkspaceHeld = false

/**
 * Freeze the launch-restore record until the returned release is called.
 *
 * A launch whose projects roster did not answer in time lands on a default-project draft,
 * and every write on that path — the draft's creation, the scope sync, the session select —
 * funnels through {@link recordChatLocation}. Unheld, the fallback landing replaced the
 * record it had failed to verify, so one slow boot lost the workspace for every later
 * launch too. The launch restore holds it until the roster answers.
 */
export function holdLastWorkspace(): () => void {
  lastWorkspaceHeld = true
  return () => {
    lastWorkspaceHeld = false
  }
}

/**
 * Record the launch-restore pair. Called from {@link recordChatLocation}.
 *
 * A null scope is not written: it means the workspace has not resolved one yet, and
 * persisting that would hand the next launch a record pointing nowhere.
 */
export function rememberLastWorkspace(projectId: string | null, sessionId: string | null): void {
  if (!projectId || lastWorkspaceHeld) return
  saveJSON(LAST_WORKSPACE_KEY, { projectId, sessionId } satisfies LastWorkspace)
}

/**
 * The launch-restore pair, or `null` when there is nothing to restore.
 *
 * Tolerates a corrupt value by treating every unusable field as absent.
 */
export function loadLastWorkspace(): LastWorkspace | null {
  const raw = loadJSON<unknown>(LAST_WORKSPACE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const projectId =
    typeof record.projectId === 'string' && record.projectId ? record.projectId : null
  const sessionId =
    typeof record.sessionId === 'string' && record.sessionId ? record.sessionId : null
  // No project ⇒ nothing to reopen. Such a record was written by a build that still had a
  // project-less "Global" scope; that scope is gone, so the pair addresses nowhere.
  if (!projectId) return null
  return { projectId, sessionId }
}

/** Drop a pair that has been CONFIRMED dead (its project or chat is gone). */
export function forgetLastWorkspace(): void {
  saveJSON(LAST_WORKSPACE_KEY, null)
}
