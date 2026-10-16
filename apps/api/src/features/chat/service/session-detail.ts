import { summarizeParticipantUsage } from '@localixai/agent'
import { getLoopEngine } from '../../loops/runtime-binding'
import { toLoopSummary } from '../../loops/contracts'
import type { createProjectsRepository } from '../../projects/repository'
import type { ChatRepository, SessionRecord } from '../repository'
import type { ModelContextRepository } from '../model-context-repository'
import { loadModelViewBoundary } from '../runtime/model-view/view'
import { toSessionSummary } from '../repository-mappers'
import { findToolItemByCallId, toSourceRuntime } from './session-access'
import type { HitlRegistry } from '../runtime/hitl-registry'
import { deriveSessionTiming } from '../session-timing'
import type { SessionDetail, SessionSourceRuntime, SessionWork } from '../contracts'
import type { ChatServiceDeps } from './context'
import type { SessionPlan } from '../../plans/contracts'
import type { ResumePoint } from '../../resume/contracts'
import type { createUsageRepository } from '../../usage/repository'
import { readSessionUsageRows, summarizeSessionUsage } from '../../usage/session-summary'
import {
  isItemStreaming,
  isToolBackedItem,
  type ToolBackedItem,
} from '@localixai/agent/agents/items'
import { isUiNavigationOutput } from '@localixai/plugin-sdk/ui'
import { isAlwaysStandaloneToolName } from '../item-format'
import type { MessageToolDetails, PersistedMessage } from '../contracts'
import { ApiError } from '../../../lib/errors'

/**
 * Assembling a `SessionDetail` — the session READ MODEL a client hydrates a session
 * from (on open, and after every mutation that returns a detail).
 *
 * It is more than "the session row plus its messages": half of it is LIVE runtime
 * state that exists only in memory (is a run active, what is queued, is a HITL
 * prompt pending, which tools are auto-approved). Knowing WHICH reads are conditional (parent messages only for
 * a sub-agent with a source tool call; the project only when an LSP manager exists),
 * which are concurrent, and which overlays a detail must carry is a single body of
 * knowledge — it lives here rather than inline in the service's composition root.
 */

/** Closure values the read model needs from createChatService. */
export interface SessionDetailContext {
  repo: ChatRepository
  /** The model's view state — read for the transcript's divider. */
  modelContexts: ModelContextRepository
  usageRepo: ReturnType<typeof createUsageRepository>
  projectsRepo: ReturnType<typeof createProjectsRepository>
  hitlRegistry: HitlRegistry
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  /** Live run state — only the runner knows it; nothing here is persisted. */
  runner: {
    isRunning: (sessionId: string) => boolean
    activeAgentId: (sessionId: string) => string | undefined
    listQueued: (sessionId: string) => Promise<SessionDetail['queuedMessages']>
    listSessionAutoApprovedTools?: (sessionId: string) => string[]
    listWork: (userId: string, sessionId: string) => SessionWork[]
    getTerminalWaits?: (userId: string, sessionId: string) => SessionDetail['terminalWaits']
  }
  /** Absent → no LSP server states are reported. */
  lspManager: ChatServiceDeps['lspManager']
  /** A root conversation's plan versions, newest first; absent → the detail carries none. */
  plans?: (userId: string, rootSessionId: string) => Promise<SessionPlan[] | undefined>
  /** A root conversation's unfinished work; absent → the detail carries none. */
  resumePoints?: (userId: string, rootSessionId: string) => Promise<ResumePoint[] | undefined>
}

function canDeferToolItem(item: ToolBackedItem): boolean {
  return (
    item.standalone !== true &&
    !isAlwaysStandaloneToolName(item.name) &&
    !(item.type === 'tool_call' && isUiNavigationOutput(item.output))
  )
}

/**
 * Preserve every field needed to group and summarize a collapsed chain, while
 * dropping fields that only a mounted card reads. Sources deliberately remain:
 * MessageSources renders outside ToolChain and must be complete on first paint.
 */
function summarizeDeferredToolItem(item: ToolBackedItem): ToolBackedItem {
  const summary = { ...item }
  delete summary.input
  delete summary.thoughtSignature
  delete summary.resultText
  delete summary.errorText
  delete summary.error
  delete summary.supersedeKey
  delete summary.gate
  switch (summary.type) {
    case 'command':
      delete summary.output
      break
    case 'mcp_call':
      delete summary.result
      break
    case 'tool_call':
      delete summary.output
      break
    case 'file_change':
      // Diffs drive the collapsed +/− aggregate, so file changes stay complete.
      break
  }
  return summary
}

/**
 * Web-only transport projection. It mirrors MessageCard's outer ToolChain
 * boundaries: narrative/standalone/navigation items split a run, and a lone
 * tool stays full because it renders immediately. A live run also stays full so
 * reconnect never inserts a loading seam into actively streaming work.
 */
export function deferCollapsedToolDetails(
  messages: readonly PersistedMessage[],
): PersistedMessage[] {
  return messages.map((message) => {
    const items = message.payload.items
    if (!items?.length) return message

    const nextItems = []
    const deferredToolItemIds: string[] = []
    let run: ToolBackedItem[] = []

    const flushRun = () => {
      const deferRun = run.length > 1 && !run.some(isItemStreaming)
      for (const item of run) {
        if (deferRun && item.type !== 'file_change') {
          nextItems.push(summarizeDeferredToolItem(item))
          deferredToolItemIds.push(item.id)
        } else {
          nextItems.push(item)
        }
      }
      run = []
    }

    for (const item of items) {
      if (isToolBackedItem(item) && canDeferToolItem(item)) {
        run.push(item)
      } else {
        flushRun()
        nextItems.push(item)
      }
    }
    flushRun()

    if (!deferredToolItemIds.length) return message
    return {
      ...message,
      payload: { ...message.payload, items: nextItems },
      deferredToolItemIds,
    }
  })
}

export async function getMessageToolDetails(
  ctx: SessionDetailContext,
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<MessageToolDetails> {
  const message = await ctx.repo.getMessage(userId, sessionId, messageId)
  if (!message) throw new ApiError(404, 'message_not_found', 'Message not found')
  return { items: (message.payload.items ?? []).filter(isToolBackedItem) }
}

export async function getSessionDetail(
  ctx: SessionDetailContext,
  userId: string,
  id: string,
  opts?: { messageLimit?: number; deferToolDetails?: boolean },
): Promise<SessionDetail> {
  const { repo, usageRepo, projectsRepo, hitlRegistry, runner, lspManager } = ctx
  const session = await ctx.requireSession(userId, id)
  // session.messages + the parent source message + the project row are all
  // independent reads once we have the session — fetch them concurrently.
  const wantsParent = Boolean(session.parentSessionId && session.sourceToolCallId)
  const wantsProject = Boolean(lspManager && session.projectId)
  const messagesPromise = repo.listMessages(userId, id)
  // Plans belong to the root (`SessionDetail.plans`). A read that fails leaves the field absent
  // — "unknown" to the client, which keeps what it had — rather than failing the whole detail.
  const plansPromise =
    !session.parentSessionId && ctx.plans
      ? ctx.plans(userId, id).catch(() => undefined)
      : Promise.resolve(undefined)
  // The root's unfinished work, read beside the plans and with the same "unknown" on failure.
  const resumePromise =
    !session.parentSessionId && ctx.resumePoints
      ? ctx.resumePoints(userId, id).catch(() => undefined)
      : Promise.resolve(undefined)
  const [messages, sourceMessage, project, queuedMessages, ledgerByKind, modelView, plans] =
    await Promise.all([
      messagesPromise,
      // sourceToolCallId is immutable provenance. Preserve the old
      // chronological-first, active-branch lookup without hydrating the parent
      // transcript just to find its one owning payload.
      wantsParent
        ? repo.findActiveBranchToolCallMessage(
            userId,
            session.parentSessionId!,
            session.sourceToolCallId!,
          )
        : Promise.resolve(null),
      wantsProject ? projectsRepo.getProject(userId, session.projectId!) : Promise.resolve(null),
      runner.listQueued(id),
      readSessionUsageRows(usageRepo, userId, id),
      messagesPromise.then((all) => loadModelViewBoundary(ctx.modelContexts, id, all)),
      plansPromise,
    ])
  const resumePoints = await resumePromise

  let sourceRuntime: SessionSourceRuntime | null = null
  let lspServers: SessionDetail['lspServers'] = []

  if (wantsParent && sourceMessage) {
    sourceRuntime = toSourceRuntime(
      session.sourceToolCallId!,
      findToolItemByCallId([sourceMessage], session.sourceToolCallId!),
    )
  }

  if (lspManager && project) {
    lspServers = lspManager.getServerStates(project.workingDir)
  }

  const pendingInteractions = hitlRegistry.listPendingInteractions(id)
  const sessionUsage = summarizeSessionUsage(messages, ledgerByKind).usage

  const visibleMessages =
    opts?.messageLimit && messages.length > opts.messageLimit
      ? messages.slice(-opts.messageLimit)
      : messages

  return {
    ...toSessionSummary(session),
    // Not part of `toSessionSummary`: the addressable name belongs to the DETAIL (see
    // SessionDetail.taskName) — the spawning caller reads it off the create response.
    taskName: session.taskName ?? null,
    sessionTiming: deriveSessionTiming(messages.map((m) => m.payload)),
    messageCount: messages.length,
    sessionUsage,
    participantUsage: summarizeParticipantUsage(messages.map((message) => message.payload)),
    work: runner.listWork(userId, id),
    terminalWaits: runner.getTerminalWaits?.(userId, id) ?? [],
    loops: (() => {
      const engine = getLoopEngine()
      if (!engine) return []
      return engine.list(userId, id).map(toLoopSummary)
    })(),
    queuedMessages,
    // A terminal/thin client can ask for only the newest N messages — a long
    // session's full history is megabytes of JSON it will never render at once.
    // messageCount above stays the FULL count so clients can tell more exist.
    messages: opts?.deferToolDetails ? deferCollapsedToolDetails(visibleMessages) : visibleMessages,
    // ALL of them, not just the head: a client rebuilding this session (reconnect
    // resync, session switch) has no other way to learn about the waiters behind it.
    pendingInteractions,
    pendingInteraction: pendingInteractions[0] ?? null,
    isRunning: runner.isRunning(id),
    activeAgentId: runner.activeAgentId(id) ?? null,
    sourceRuntime,
    lspServers,
    // Current "Always allow" set so the composer permissions chip survives a
    // reload (not only the live `session_permissions.updated` event).
    autoApprovedTools: runner.listSessionAutoApprovedTools?.(id) ?? [],
    modelView,
    ...(plans ? { plans } : {}),
    ...(resumePoints ? { resumePoints } : {}),
  }
}
