// localStorage-backed UI preferences for the chat workspace. Each accessor
// swallows storage failures (private-mode/quota/disabled) and degrades to a
// null read or a no-op write so the store never throws on a flaky storage.

import { loadJSON, loadString, saveJSON, saveString } from '@localixai/plugin-sdk/ui/storage'
import { isReasoningEffort, REASONING_OPTIONS, type ReasoningEffort } from './reasoning'

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
 * history, and the reasoning level to carry into the next chat — a preference, not a pointer.
 * A stale scope or chat id is already handled: the launch restore verifies the pair and
 * `forgetLastWorkspace` drops it when it is confirmed dead.
 */
const ACTIVE_SESSION_KEY = 'localix_active_session_id'
const ACTIVE_PROJECT_KEY = 'localix_active_project_id'
const LAST_WORKSPACE_KEY = 'localix_last_workspace'
const LAST_REASONING_KEY = 'localix_last_reasoning'
const PROMPT_HISTORY_KEY = 'localix_prompt_history'
const PROMPT_HISTORY_LIMIT = 150

const activeSessionKey = (projectId?: string | null) =>
  projectId ? `${ACTIVE_SESSION_KEY}_${projectId}` : ACTIVE_SESSION_KEY

export function rememberActiveSession(id: string | null, projectId?: string | null) {
  saveString(activeSessionKey(projectId), id)
  // Also record the launch-restore PAIR. This is the one funnel that means "session `id`
  // is the active chat of scope `projectId`", so it is the only honest place to write the
  // pair — and writing both halves as a single JSON value is what makes the record
  // untearable: two windows racing can each write a whole pair, but neither can leave
  // window A's project next to window B's session, which is what reading two independent
  // keys back allowed.
  rememberLastWorkspace(projectId ?? null, id)
}

export function loadRememberedActiveSession(projectId?: string | null): string | null {
  return loadString(activeSessionKey(projectId))
}

/**
 * The highest effort that CARRIES to the next session.
 *
 * Model and mode stick unconditionally, and reasoning mostly should too — but the top two rungs
 * are different in kind: they are what you reach for on one hard problem, and remembering them
 * turns a single deliberate choice into a permanent, invisible multiplier on every new chat's
 * cost. The session you set them on keeps them (this only governs what a NEW session inherits),
 * and the picker still shows the real value, so nothing is hidden — it just stops compounding.
 */
const MAX_REMEMBERED_REASONING: ReasoningEffort = 'high'

export function rememberLastReasoning(reasoningEffort: ReasoningEffort) {
  // `off` is never remembered. It is what a model that cannot reason resolves to, not a level
  // the person chose for the next chat — and remembering it seeded every new session with no
  // thinking at all, which is how one pick of a non-reasoning model turned the whole picker
  // off. An explicit Off still applies to the session it was chosen in.
  if (reasoningEffort === 'off') return
  // Otherwise stored verbatim. Clamping on write too was the obvious symmetry and is dead
  // weight — falsified: removing it leaves every test green, because the read side has to clamp
  // anyway (values written before this rule are already in localStorage) and one clamp cannot
  // disagree with itself.
  saveString(LAST_REASONING_KEY, reasoningEffort)
}

export function loadLastReasoning(): ReasoningEffort | null {
  const v = loadString(LAST_REASONING_KEY)
  if (!isReasoningEffort(v)) return null
  // Also clamp on READ: a value stored before this rule existed is still sitting in localStorage,
  // and the whole point is that an old `max` stops seeding new sessions.
  const rank = (effort: ReasoningEffort) => REASONING_OPTIONS.findIndex((o) => o.value === effort)
  return rank(v) > rank(MAX_REMEMBERED_REASONING) ? MAX_REMEMBERED_REASONING : v
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

export function rememberActiveProjectId(id: string | null) {
  saveString(ACTIVE_PROJECT_KEY, id)
}

export function loadActiveProjectId(): string | null {
  return loadString(ACTIVE_PROJECT_KEY)
}

/**
 * The scope + chat the user was last actually in — the record a cold launch reopens from.
 *
 * WHY A SECOND RECORD. `localix_active_project_id` and the per-scope
 * `localix_active_session_id_*` keys already hold both halves, and the launch restore used
 * to read them back separately. That is a torn read waiting to happen across windows, and
 * it also loses the one fact the restore needs most: WHICH scope the pair describes. One
 * atomic value answers both. The old keys stay — they serve scope round-trips inside a
 * running window (`selectProject`), a different job.
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
 * funnels through {@link rememberActiveSession}. Unheld, the fallback landing replaced the
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
 * Record the launch-restore pair. Called from {@link rememberActiveSession}.
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
 * Falls back to the two legacy keys when the record is absent (an install that predates
 * it, so the first launch after an update still reopens the right workspace) and tolerates
 * a corrupt value by treating every unusable field as absent.
 */
export function loadLastWorkspace(): LastWorkspace | null {
  const raw = loadJSON<unknown>(LAST_WORKSPACE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return legacyLastWorkspace()
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

function legacyLastWorkspace(): LastWorkspace | null {
  const projectId = loadActiveProjectId()
  if (!projectId) return null
  return { projectId, sessionId: loadRememberedActiveSession(projectId) }
}
