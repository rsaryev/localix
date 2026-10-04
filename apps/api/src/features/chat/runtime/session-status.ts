import type { AgentItemStatus } from '@localixai/agent/agents'
import type { LiveItemResolver } from './agent-runner-state'

import { toSessionSummary, type ChatRepository, type SessionRecord } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import type { ChildRuntimeSession } from './agent-runner-state'

export function publishChildSummary(params: {
  streamRegistry: SessionStreamRegistry
  parentSessionId: string
  child: SessionRecord
}) {
  const summary = toSessionSummary(params.child)
  params.streamRegistry.publish(params.child.userId, params.child.id, {
    type: 'session.updated',
    session: summary,
  })
  params.streamRegistry.publish(params.child.userId, params.parentSessionId, {
    type: 'child_session.updated',
    parentSessionId: params.parentSessionId,
    session: summary,
  })
}

/** A child session's terminal runtimeStatus → the tool item status it implies. */
const TERMINAL_ITEM_STATUS: Partial<Record<SessionRecord['runtimeStatus'], AgentItemStatus>> = {
  completed: 'completed',
  failed: 'failed',
  stopped: 'aborted',
}

/**
 * When a child session (e.g. a delegate sub-agent) reaches a terminal state,
 * the tool call that spawned it is still marked `running` in the parent's
 * message — the tool returns immediately and the child runs asynchronously.
 * Resolve that item here, on the child's completion path, so the parent's
 * spinner clears. The wire link is canonical: the child's `sourceToolCallId`
 * IS the parent item's `toolCallId`.
 *
 * Run-aware: if the parent run is still active, `liveItemResolvers` contains
 * a callback that patches `state.currentPayload` IN PLACE and calls
 * `persistAndPublish` — the same in-memory technique background jobs use via
 * `emitBackground`. This avoids the write-ordering race where a later
 * `persistAndPublish` from the still-running parent would re-write
 * `state.currentPayload` (which still has `status: 'running'`) and clobber
 * the DB patch written by this function.
 *
 * If no live resolver exists (parent run already ended), fall back to the
 * DB-walk + `message.updated` publish path, which remains correct.
 */
async function resolveParentToolItem(params: {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  userId: string
  child: SessionRecord
  liveItemResolvers: Map<string, LiveItemResolver>
}): Promise<void> {
  const { repo, streamRegistry, userId, child, liveItemResolvers } = params
  const parentSessionId = child.parentSessionId
  const toolCallId = child.sourceToolCallId
  if (!parentSessionId || !toolCallId) return
  const itemStatus = TERMINAL_ITEM_STATUS[child.runtimeStatus]
  if (!itemStatus) return

  // Live path: parent run still active — patch in-memory payload, no DB race.
  const liveResolver = liveItemResolvers.get(toolCallId)
  if (liveResolver?.({ status: itemStatus })) return

  // Fallback path: parent run already ended — point-read the one active-branch
  // row whose matching item is still running, then persist its terminal status.
  const message = await repo.findActiveBranchToolCallMessage(
    userId,
    parentSessionId,
    toolCallId,
    'running',
  )
  const items = message?.payload.items
  const target = items?.find(
    (item) => 'toolCallId' in item && item.toolCallId === toolCallId && item.status === 'running',
  )
  if (!message || !items || !target) return

  const timestamp = params.now()
  // Only `items` is ours to write; the repo merges it into the row and hands back what the
  // row now holds (the `??` covers the row vanishing between the list and the write).
  const patch = {
    items: items.map((item) => (item === target ? { ...item, status: itemStatus } : item)),
  }
  const payload = (await repo.updateMessage(userId, parentSessionId, message.id, patch, timestamp))
    ?.payload ?? {
    ...message.payload,
    ...patch,
  }
  streamRegistry.publish(userId, parentSessionId, {
    type: 'message.updated',
    sessionId: parentSessionId,
    message: { ...message, payload, updatedAt: timestamp },
  })
}

export async function markRuntimeSessionStatus(params: {
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  userId: string
  session: SessionRecord
  status: SessionRecord['runtimeStatus']
  /** Registry of live item resolvers keyed by toolCallId (from RuntimeState). */
  liveItemResolvers: Map<string, LiveItemResolver>
}): Promise<SessionRecord> {
  if (params.session.sessionKind === 'chat') return params.session
  const timestamp = params.now()
  const updated: SessionRecord = {
    ...params.session,
    runtimeStatus: params.status,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
  }
  await params.repo.updateSession(params.userId, updated.id, updated)
  params.streamRegistry.publish(params.userId, updated.id, {
    type: 'session.updated',
    session: toSessionSummary(updated),
  })
  if (updated.parentSessionId) {
    publishChildSummary({
      streamRegistry: params.streamRegistry,
      parentSessionId: updated.parentSessionId,
      child: updated,
    })
    // A terminal child clears the parent's still-`running` spawning tool item.
    if (updated.runtimeStatus !== 'running') {
      await resolveParentToolItem({
        repo: params.repo,
        streamRegistry: params.streamRegistry,
        now: params.now,
        userId: params.userId,
        child: updated,
        liveItemResolvers: params.liveItemResolvers,
      })
    }
  }
  return updated
}

export async function markChildStopped(params: {
  childRuntime: ChildRuntimeSession
  markStatus: (
    userId: string,
    session: SessionRecord,
    status: SessionRecord['runtimeStatus'],
  ) => Promise<SessionRecord>
  childRuntimeSessions: Map<string, ChildRuntimeSession>
}) {
  const stopped = await params.markStatus(
    params.childRuntime.userId,
    params.childRuntime.session,
    'stopped',
  )
  params.childRuntimeSessions.set(stopped.id, {
    ...params.childRuntime,
    session: stopped,
  })
}
