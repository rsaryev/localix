import type { UiSession } from '@/shared/api/contracts'

/**
 * The single workspace-scope predicate.
 *
 * A scope IS a project — there is no project-less one. `null` therefore means the scope has
 * not resolved yet (the first frames of a cold launch), and nothing belongs to it; it is
 * never a wildcard for every project.
 */
export function sessionBelongsToScope(
  session: Pick<UiSession, 'projectId'>,
  activeProjectId: string | null,
): boolean {
  return activeProjectId !== null && session.projectId === activeProjectId
}

/** Backend default title for a freshly created chat (see api service.ts). */
const DEFAULT_SESSION_TITLE = 'New Chat'

/**
 * An "empty draft": a root chat with no messages and the default/blank title —
 * i.e. a New Chat the user never used. This is eligibility, not ownership: the
 * creation lane separately limits reuse to its own recent drafts.
 *
 * "No messages" is read from the PERSISTED count, not from `messages`. A list row
 * never carries a body, and switching away evicts the body of the chat you left
 * (`activateSessionBody` keeps only client notices), so `messages` is empty for
 * almost every chat that is not open. Reading it made each used chat whose title
 * was still "New Chat" look like a draft: New chat jumped to one, opening it
 * loaded its body, the next click jumped to the next one — several clicks landed
 * in several old chats before a real new one was made. A client notice (a model
 * change on an untouched draft) is not conversation, so it does not count.
 */
export function isEmptyDraftSession(s: UiSession): boolean {
  return (
    !s.externalAgentProvider &&
    !s.isArchived &&
    !s.isPinned &&
    s.sessionKind !== 'subagent' &&
    s.sessionKind !== 'job' &&
    !s.parentSessionId &&
    !s.isRunning &&
    s.messageCount === 0 &&
    !(s.messages ?? []).some((message) => message.role !== 'system') &&
    (!s.title?.trim() || s.title.trim() === DEFAULT_SESSION_TITLE)
  )
}

/**
 * A "sub-session" = an ephemeral run artifact attached to a chat: a delegated task
 * worker (`job`/`subagent`) or a task/message thread (`system` / `message-thread:`).
 * These stream in via `child_session.updated` and, unlike root chats, are not the
 * user's durable work — once finished they only ever accumulate in the client store.
 */
function isSubSession(s: UiSession): boolean {
  return (
    s.sessionKind === 'job' ||
    s.sessionKind === 'subagent' ||
    s.sessionKind === 'system' ||
    (s.sourceToolCallId?.startsWith('message-thread:') ?? false)
  )
}

/** Max FINISHED sub-sessions retained per host chat before the oldest are evicted. */
export const MAX_FINISHED_SUBSESSIONS_PER_HOST = 25

/**
 * Hard ceiling on sub-session rows retained OVERALL, across every host.
 *
 * The per-host rule below cannot bound anything on its own: it exempts every still-RUNNING
 * sub-session, and one `delegate` fan-out is enough to make that exemption unbounded — a session
 * once spawned 782 concurrent sub-agents and the roster held all of them, each a live row the
 * sidebar/breadcrumb/runtime-panel re-derived over. Two hundred is far above any roster a human
 * reads and far below the point where the derivations cost anything.
 */
export const MAX_RETAINED_SUBSESSIONS = 200

/**
 * Bound the unbounded growth of finished sub-sessions in `allSessions`. Every
 * delegated run / delegated task run / thread that ever ran stays in the client store
 * for the tab's lifetime (it's never removed on completion), so a long working
 * session piles up dozens of dead sub-session rows — each one live DOM + listeners
 * the GC can't reclaim, and extra entries the sidebar re-maps on every tick.
 *
 * Keeps: every root/fork chat, every still-RUNNING sub-session, and the most
 * recent {@link MAX_FINISHED_SUBSESSIONS_PER_HOST} FINISHED sub-sessions per host
 * (by `updatedAt`) — then, as a backstop the per-host rule cannot provide, at most
 * {@link MAX_RETAINED_SUBSESSIONS} sub-session rows in total. Returns the same array reference
 * when nothing is evicted, so subscribers aren't handed a needlessly new identity.
 */
export function pruneFinishedSubSessions(
  allSessions: UiSession[],
  cap = MAX_FINISHED_SUBSESSIONS_PER_HOST,
  overallCap = MAX_RETAINED_SUBSESSIONS,
): UiSession[] {
  const finishedByHost = new Map<string, UiSession[]>()
  const subSessions: UiSession[] = []
  for (const s of allSessions) {
    if (!isSubSession(s)) continue
    subSessions.push(s)
    if (s.isRunning) continue
    const host = s.parentSessionId ?? s.rootSessionId ?? '∅'
    const list = finishedByHost.get(host)
    if (list) list.push(s)
    else finishedByHost.set(host, [s])
  }

  const evict = new Set<string>()
  for (const list of finishedByHost.values()) {
    if (list.length <= cap) continue
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    for (let i = cap; i < list.length; i++) evict.add(list[i].id)
  }

  // Overall backstop, applied to whatever the per-host pass kept. Running rows are NOT exempt here
  // — they are precisely what overflows this cap — so eviction is purely most-recently-updated
  // wins. A row dropped while its run is still live is re-added by its next `child_session.updated`
  // (the store upserts on that event), so this degrades the tail of an absurd roster rather than
  // losing a session.
  const retained = evict.size === 0 ? subSessions : subSessions.filter((s) => !evict.has(s.id))
  if (retained.length > overallCap) {
    const byRecency = [...retained].sort((a, b) => b.updatedAt - a.updatedAt)
    for (let i = overallCap; i < byRecency.length; i++) evict.add(byRecency[i].id)
  }

  if (evict.size === 0) return allSessions
  return allSessions.filter((s) => !evict.has(s.id))
}

export function compareSessions(a: UiSession, b: UiSession): number {
  if (a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned)
  return b.updatedAt - a.updatedAt
}

export function sortSessions(sessions: UiSession[]): UiSession[] {
  // Fast path: stream events fire many times per second but rarely reorder the
  // list. If the array is already ordered, return it as-is to skip the spread +
  // sort allocation (and avoid handing subscribers a needlessly new reference).
  for (let i = 1; i < sessions.length; i++) {
    if (compareSessions(sessions[i - 1], sessions[i]) > 0) {
      return [...sessions].sort(compareSessions)
    }
  }
  return sessions
}
