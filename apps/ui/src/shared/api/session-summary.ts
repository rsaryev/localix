import type { UiSession } from './contracts'

/**
 * A held session cut back to what a SUMMARY says — the shape `toUiSessionSummary`
 * (`./converters`) answers.
 *
 * The defect it stops: the launch frame (`shellSnapshot.ts`) recorded the store's
 * MERGED sessions, so a body leaked into it — `plans`, messages, and `bodyLoaded: true`. The next
 * launch painted that body as if it were loaded, so the detail was never refetched, and the roster
 * revalidation (a summary, which keeps what it does not carry) wrote the stale body back. A plan
 * approved hours ago was offered for approval on every launch. Whatever leaves the store as a
 * roster goes through here: detail-only fields drop to the summary's own defaults, so a restored
 * row is "not loaded", and the open chat fetches its truth.
 *
 * `converters.test.ts` pins the key set to the summary converter's, so the two cannot drift.
 */
export function uiSessionSummary(session: UiSession): UiSession {
  return {
    id: session.id,
    seq: session.seq ?? 0,
    title: session.title,
    messages: [],
    bodyLoaded: false,
    isPinned: session.isPinned,
    isArchived: session.isArchived ?? false,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    pendingInteraction: null,
    pendingInteractionQueue: [],
    isRunning: session.isRunning,
    projectId: session.projectId,
    parentSessionId: session.parentSessionId,
    rootSessionId: session.rootSessionId,
    sessionKind: session.sessionKind,
    agent: session.agent,
    permissionMode: session.permissionMode,
    closedAt: session.closedAt ?? null,
    description: session.description,
    runtimeStatus: session.runtimeStatus,
    ...(session.externalAgentProvider
      ? { externalAgentProvider: session.externalAgentProvider }
      : {}),
    ...(session.externalAgentSessionKey
      ? { externalAgentSessionKey: session.externalAgentSessionKey }
      : {}),
    sourceToolCallId: session.sourceToolCallId,
    sourceRuntime: null,
    pinnedSkills: session.pinnedSkills ?? [],
    sessionTiming: session.sessionTiming ?? null,
    messageCount: session.messageCount ?? 0,
    ...(session.lastMessage ? { lastMessage: session.lastMessage } : {}),
    loops: session.loops ?? [],
    work: session.work ?? [],
    queuedMessages: session.queuedMessages ?? [],
    lspServers: [],
    lspDiagnostics: {},
  }
}
