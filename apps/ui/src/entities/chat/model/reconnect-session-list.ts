import type { UiSession } from '@/shared/api/contracts'

/**
 * Apply the server-owned fields carried by a session-list summary without
 * resetting detail/live-only state that the summary converter fills with empty
 * defaults merely to satisfy `UiSession`.
 */
export function mergeSessionListSummary(current: UiSession, summary: UiSession): UiSession {
  return {
    ...current,
    seq: summary.seq,
    title: summary.title,
    revision: summary.revision,
    description: summary.description,
    avatar: summary.avatar,
    externalAgentProvider: summary.externalAgentProvider,
    externalAgentSessionKey: summary.externalAgentSessionKey,
    isPinned: summary.isPinned,
    isArchived: summary.isArchived,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    agents: summary.agents,
    ...(summary.modelChoices ? { modelChoices: summary.modelChoices } : {}),
    permissionMode: summary.permissionMode,
    isRunning: summary.isRunning,
    projectId: summary.projectId,
    parentSessionId: summary.parentSessionId,
    rootSessionId: summary.rootSessionId,
    sessionKind: summary.sessionKind,
    runtimeStatus: summary.runtimeStatus,
    sourceToolCallId: summary.sourceToolCallId,
    pinnedSkills: summary.pinnedSkills,
    sessionTiming: summary.sessionTiming,
    messageCount: summary.messageCount,
    loops: summary.loops,
    queuedMessages: summary.queuedMessages,
  }
}

/**
 * Reconcile a full session-list response without losing stream events that
 * landed while the request was in flight.
 *
 * Object identity is the generation token, matching detail reconciliation:
 * unchanged rows accept the authoritative summary (and missing unchanged rows
 * are deletions); new or changed rows are newer than the request and survive.
 */
export function reconcileSessionListAfterReconnect(
  before: readonly UiSession[],
  current: readonly UiSession[],
  summaries: readonly UiSession[],
): UiSession[] {
  const beforeById = new Map(before.map((session) => [session.id, session]))
  const currentById = new Map(current.map((session) => [session.id, session]))
  const summaryIds = new Set(summaries.map((session) => session.id))

  const reconciled = summaries
    .filter((summary) => !beforeById.has(summary.id) || currentById.has(summary.id))
    .map((summary) => {
      const live = currentById.get(summary.id)
      if (!live) return summary
      const baseline = beforeById.get(summary.id)
      if (!baseline || live !== baseline) return live
      return mergeSessionListSummary(live, summary)
    })

  for (const live of current) {
    if (summaryIds.has(live.id)) continue
    const baseline = beforeById.get(live.id)
    if (!baseline || live !== baseline) reconciled.push(live)
  }

  return reconciled
}
