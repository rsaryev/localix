import { latestActiveTerminalWait } from '@localixai/agent'

import type {
  Message,
  PendingAskInteraction,
  PendingConfirmInteraction,
  PendingHitlInteraction,
  PendingRequestSecretInteraction,
  PersistedMessage,
  SessionDetail,
  SessionSummary,
  UiPendingHitlInteraction,
  UiSession,
} from './contracts'
import { withModelViewDivider } from './modelViewDivider'

// Wire→UI converters: map backend DTOs (PersistedMessage / SessionSummary /
// SessionDetail / PendingHitlInteraction) into the store's UI shapes. Extracted
// from contracts.ts so that file holds type definitions and this one holds the
// mapping logic.

export function toUiMessage(message: PersistedMessage): Message {
  const presentation = message.payload as {
    systemNotice?: Message['systemNotice']
    commandOutput?: Omit<NonNullable<Message['commandOutput']>, 'text'>
  }
  const systemOwned = Boolean(presentation.systemNotice || presentation.commandOutput)
  return {
    id: message.id,
    role: systemOwned ? 'system' : message.payload.role,
    from: message.payload.from,
    authorSnapshot: message.payload.authorSnapshot,
    // Beside the author, because it is the same kind of fact about the row: who put what on it.
    reactions: (message.payload as { reactions?: Message['reactions'] }).reactions,
    pinned: (message.payload as { pinned?: true }).pinned === true ? true : undefined,
    taskStates: message.payload.taskStates,
    content: message.payload.content,
    systemNotice: presentation.systemNotice,
    commandOutput: presentation.commandOutput
      ? { ...presentation.commandOutput, text: message.payload.content ?? '' }
      : undefined,
    reasoning: message.payload.reasoning,
    items: message.payload.items,
    deferredToolItemIds: message.deferredToolItemIds,
    dataParts: message.payload.dataParts,
    usage: message.payload.usage,
    cacheDiagnostics: message.payload.cacheDiagnostics,
    status: message.payload.status,
    branchIndex: message.branch?.index,
    branchCount: message.branch?.count,
    isInternal: (message.payload as { isInternal?: boolean }).isInternal,
    continuedFromMessageId: message.payload.continuedFromMessageId,
    uiOnly: (message.payload as { uiOnly?: boolean }).uiOnly,
    clientMessageIds: (message.payload as { clientMessageIds?: string[] }).clientMessageIds,
    bindings: (message.payload as { bindings?: Message['bindings'] }).bindings,
    timing: (message.payload as { timing?: Message['timing'] }).timing,
    providerMeta: (message.payload as { providerMeta?: Message['providerMeta'] }).providerMeta,
    commandOrigin: (message.payload as { commandOrigin?: Message['commandOrigin'] }).commandOrigin,
    // Provenance of an autonomous wake — the payload's opaque `origin` tag narrowed to
    // the domain WakeSource union (loop/plugin/external/bg-job/bg-monitor/hook, plus `sleep`
    // which no longer has a producer but is still stamped on older stored turns). The
    // card only renders known sources, so a non-WakeSource origin (e.g. `delegate`) is inert.
    wakeSource: (message.payload as { origin?: Message['wakeSource'] }).origin,
    createdAt: message.createdAt,
  }
}

function toUiPendingInteraction(
  interaction: PendingHitlInteraction | null,
): UiPendingHitlInteraction | null {
  if (!interaction) return null
  if (interaction.kind === 'ask') {
    return {
      kind: 'ask',
      sourceSessionId: interaction.sourceSessionId,
      request: {
        id: interaction.requestId,
        kind: 'ask',
        title: interaction.title,
        payload: interaction.payload as PendingAskInteraction['request']['payload'],
      },
    }
  }
  if (interaction.kind === 'confirm') {
    return {
      kind: 'confirm',
      sourceSessionId: interaction.sourceSessionId,
      request: {
        id: interaction.requestId,
        kind: 'confirm',
        title: interaction.title,
        payload: interaction.payload as PendingConfirmInteraction['request']['payload'],
      },
    }
  }
  if (interaction.kind === 'request_secret') {
    return {
      kind: 'request_secret',
      sourceSessionId: interaction.sourceSessionId,
      request: {
        id: interaction.requestId,
        kind: 'request_secret',
        title: interaction.title,
        payload: interaction.payload as PendingRequestSecretInteraction['request']['payload'],
      },
    }
  }
  return null
}

export function toUiSessionSummary(summary: SessionSummary): UiSession {
  return {
    id: summary.id,
    seq: summary.seq ?? 0,
    title: summary.title,
    messages: [],
    bodyLoaded: false,
    isPinned: summary.isPinned,
    isArchived: summary.isArchived ?? false,
    createdAt: Date.parse(summary.createdAt),
    updatedAt: Date.parse(summary.updatedAt),
    revision: summary.updatedAt,
    pendingInteraction: null,
    pendingInteractionQueue: [],
    isRunning: summary.runtimeStatus === 'running',
    projectId: summary.projectId,
    parentSessionId: summary.parentSessionId,
    rootSessionId: summary.rootSessionId,
    sessionKind: summary.sessionKind,
    agents: summary.agents,
    rosterLocked: summary.rosterLocked,
    permissionMode: summary.permissionMode,
    closedAt: summary.closedAt ?? null,
    description: summary.description,
    avatar: summary.avatar,
    runtimeStatus: summary.runtimeStatus,
    ...(summary.externalAgentProvider
      ? { externalAgentProvider: summary.externalAgentProvider }
      : {}),
    ...(summary.externalAgentSessionKey
      ? { externalAgentSessionKey: summary.externalAgentSessionKey }
      : {}),
    sourceToolCallId: summary.sourceToolCallId,
    sourceRuntime: null,
    pinnedSkills: summary.pinnedSkills ?? [],
    sessionTiming: summary.sessionTiming ?? null,
    messageCount: summary.messageCount ?? 0,
    // Spread-conditional, not `?? undefined`: a live `session.updated` omits the preview,
    // and writing the key back as undefined would blank the sidebar row mid-run.
    ...(summary.lastMessage ? { lastMessage: summary.lastMessage } : {}),
    loops: summary.loops ?? [],
    work: summary.work ?? [],
    questions: summary.questions ?? [],
    queuedMessages: summary.queuedMessages ?? [],
    lspServers: [],
    lspDiagnostics: {},
  }
}

export function toUiSession(detail: SessionDetail): UiSession {
  const persistedMessages = detail.messages.map(toUiMessage)
  const lastConversationMessage = [...persistedMessages]
    .reverse()
    .find((message) => message.role !== 'system')
  const restoredWaitMessages = (detail.terminalWaits ?? []).map((wait) => ({
    id: `terminal-wait-snapshot-${wait.terminalId}`,
    role: 'system' as const,
    afterMessageId: lastConversationMessage?.id ?? null,
    withinMessage:
      lastConversationMessage?.role === 'assistant'
        ? lastConversationMessage.items?.length
          ? { itemId: lastConversationMessage.items.at(-1)!.id }
          : { contentOffset: lastConversationMessage.content?.length ?? 0 }
        : undefined,
    systemNotice: {
      kind: 'terminal_activity' as const,
      tone: 'neutral' as const,
      text: 'Waiting for background terminal',
      detail: wait.label,
    },
    terminalLifecycle: {
      kind: 'waiting' as const,
      terminalId: wait.terminalId,
      active: true,
      count: 1,
      label: wait.label,
    },
  }))
  const messages = withModelViewDivider(
    [...persistedMessages, ...restoredWaitMessages],
    detail.modelView,
  )
  const restoredWait = latestActiveTerminalWait(messages)
  return {
    id: detail.id,
    seq: detail.seq ?? 0,
    title: detail.title,
    // Active terminal waits are volatile, client-only rows. Rehydrate them from
    // the server snapshot so reconnect does not depend on a live event replay to
    // restore the transcript; the reducer coalesces a replay into this stable id.
    messages,
    bodyLoaded: true,
    sessionUsage: detail.sessionUsage,
    isPinned: detail.isPinned,
    isArchived: detail.isArchived ?? false,
    createdAt: Date.parse(detail.createdAt),
    updatedAt: Date.parse(detail.updatedAt),
    revision: detail.updatedAt,
    pendingInteraction: toUiPendingInteraction(detail.pendingInteraction),
    // The waiters BEHIND the head. This was `[]` on the premise that "the server hands
    // back only the ONE live request it tracks; anything queued is re-delivered by the
    // stream" — both halves were false, and the same wrong sentence had been copied
    // into a second client. The runtime always tracked every request; the detail
    // exposed only the first. And the
    // stream cannot restore what the reconnect resync then erases: this session object
    // is built AFTER an await and lands on top of the replayed `hitl.requested` frames.
    pendingInteractionQueue: (detail.pendingInteractions ?? [])
      .slice(1)
      .map(toUiPendingInteraction)
      .filter((i): i is UiPendingHitlInteraction => i !== null),
    isRunning: detail.isRunning ?? false,
    activeAgentId: detail.activeAgentId ?? null,
    projectId: detail.projectId,
    parentSessionId: detail.parentSessionId,
    rootSessionId: detail.rootSessionId,
    sessionKind: detail.sessionKind,
    agents: detail.agents,
    rosterLocked: detail.rosterLocked,
    permissionMode: detail.permissionMode,
    closedAt: detail.closedAt ?? null,
    description: detail.description,
    avatar: detail.avatar,
    runtimeStatus: detail.runtimeStatus,
    ...(detail.externalAgentProvider
      ? { externalAgentProvider: detail.externalAgentProvider }
      : {}),
    ...(detail.externalAgentSessionKey
      ? { externalAgentSessionKey: detail.externalAgentSessionKey }
      : {}),
    sourceToolCallId: detail.sourceToolCallId,
    sourceRuntime: detail.sourceRuntime,
    pinnedSkills: detail.pinnedSkills ?? [],
    sessionTiming: detail.sessionTiming ?? null,
    messageCount: detail.messageCount ?? 0,
    loops: detail.loops ?? [],
    work: detail.work ?? [],
    questions: detail.questions ?? [],
    queuedMessages: detail.queuedMessages ?? [],
    lspServers: detail.lspServers ?? [],
    lspDiagnostics: {},
    // "Always allow" set carried on detail load so the permissions chip survives a reload.
    autoApprovedTools: detail.autoApprovedTools ?? [],
    // A root's plan versions — the authority that replaces the stored list on every detail read
    // (`mergeSessionBody`). Spread-conditional: a child's detail, or one whose plans could not be
    // read, omits them, and that means "unknown", not "none".
    ...(detail.plans ? { plans: detail.plans } : {}),
    // The root's unfinished work, with the same "absent is unknown" rule as the plans.
    ...(detail.resumePoints ? { resumePoints: detail.resumePoints } : {}),
    activePhase: restoredWait
      ? {
          id: `terminal-wait:${restoredWait.terminalId}`,
          label: restoredWait.label ?? 'Waiting for background terminal',
        }
      : null,
  }
}
