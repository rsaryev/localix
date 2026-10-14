import { randomUUID } from 'node:crypto'

import type { ParticipantRef, StoredMessagePayload } from '../../../../db'
import { emptyAssistantPayload, toPersistedMessage } from '../message-envelope'
import type { RunTurnState } from './turn-state'
import type { RunEnv } from './types'

export interface RetryCheckpoint {
  completedTurnCheckpoint?: RunTurnState['completedTurnCheckpoint']
  checkpointState?: Pick<RunTurnState, 'payload' | 'currentPayload'>
}

/** Keep late background/live resolvers on the same prefix written to the DB. */
export function restoreCompletedTurnCheckpoint(
  state: RetryCheckpoint['checkpointState'],
  payload: StoredMessagePayload,
): void {
  if (!state) return
  state.payload = payload
  state.currentPayload = payload
}

/**
 * Preserve settled work before either recovery path reads history. Like LangGraph's pending
 * writes (pregel/_loop.py), the checkpoint prevents a retry from forgetting completed effects.
 * This is a turn checkpoint, not an exactly-once guarantee for an interrupted tool.
 */
export async function persistRetryCheckpoint(
  args: RetryCheckpoint & {
    env: Pick<RunEnv, 'persistAndPublish'>
    userId: string
    sessionId: string
    assistantMessageId: string
    signal: AbortSignal
  },
): Promise<void> {
  args.signal.throwIfAborted()
  const checkpoint = args.completedTurnCheckpoint
  if (!checkpoint) return
  restoreCompletedTurnCheckpoint(args.checkpointState, checkpoint.payload)
  await args.env.persistAndPublish(
    args.userId,
    args.sessionId,
    args.assistantMessageId,
    checkpoint.payload,
    checkpoint.createdAt,
  )
  args.signal.throwIfAborted()
}

/**
 * A settled row becomes history and gets a fresh response row. Without settled work, reuse
 * the failed row and exclude its incomplete response. Call after persisting the checkpoint;
 * the history it returns is plain rows — a recovery that needs a context checkpoint asks the
 * lane for one (`checkpointDue`) before re-entering, and the rerun's history stage plans it.
 */
export async function prepareRetryContinuation(args: {
  env: Pick<RunEnv, 'repo' | 'deps' | 'now'>
  userId: string
  sessionId: string
  /** Who authors the fresh response row — the session's agent, named by the caller. */
  agent: ParticipantRef
  assistantMessageId: string
  completedTurnCheckpoint?: RetryCheckpoint['completedTurnCheckpoint']
  signal?: AbortSignal
}): Promise<{
  assistantMessageId: string
  historyMessages: Awaited<ReturnType<RunEnv['repo']['listMessages']>>
}> {
  args.signal?.throwIfAborted()
  const all = await args.env.repo.listMessages(args.userId, args.sessionId)
  args.signal?.throwIfAborted()
  if (!args.completedTurnCheckpoint) {
    return {
      assistantMessageId: args.assistantMessageId,
      historyMessages: all.filter((message) => message.id !== args.assistantMessageId),
    }
  }

  const timestamp = args.env.now()
  const payload = emptyAssistantPayload(randomUUID(), args.agent)
  const message = toPersistedMessage(args.userId, args.sessionId, payload, timestamp)
  await args.env.repo.insertMessage(message)
  // Publish an inserted row even if Stop raced the write; durable and live views must agree.
  args.env.deps.streamRegistry.publish(args.userId, args.sessionId, {
    type: 'message.created',
    sessionId: args.sessionId,
    message,
  })
  args.signal?.throwIfAborted()
  return { assistantMessageId: message.id, historyMessages: all }
}
