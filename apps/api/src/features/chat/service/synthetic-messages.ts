import { SYSTEM_PARTICIPANT, USER_PARTICIPANT } from '../../../db'
import { randomUUID } from 'node:crypto'

import type { StoredCommandOutput, StoredMessagePayload, StoredSystemNotice } from '../../../db'
import type { createChatRepository, SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import { persistAndPublishMessage } from './message-builders'
import { insertUiNote } from '../runtime/message-persistence'

export interface SyntheticMessageDeps {
  repo: ReturnType<typeof createChatRepository>
  streamRegistry: SessionStreamRegistry
  publishSession: (session: SessionRecord) => void
}

/**
 * Synthetic message insertion: persist user/assistant/boundary messages and
 * emit the SSE events the UI expects, WITHOUT running the agent loop. Used for
 * direct slash-command replies (/usage, /model …) and the `/clear` context boundary.
 */
export function createSyntheticMessages(deps: SyntheticMessageDeps) {
  const { repo, streamRegistry } = deps

  const commandName = (prompt: string): string => prompt.trim().match(/^\/[\w:-]+/)?.[0] ?? '/'
  const commandTone = (text: string): StoredCommandOutput['tone'] => {
    const firstLine = text.trimStart().split('\n', 1)[0] ?? ''
    if (/^(?:error\b|failed\b|could not\b|no (?:plugin|provider)\b|.*\bfailed:)/i.test(firstLine))
      return 'error'
    if (/^warning\b/i.test(firstLine)) return 'warning'
    if (
      /^(?:saved\b|removed\b|cleared\b|scaffolded\b|added marketplace\b|installed\b|enabled\b|disabled\b|updated\b|plugins reloaded\b|context cleared\b)/i.test(
        firstLine,
      )
    )
      return 'success'
    return 'neutral'
  }

  /**
   * Persist a synthetic assistant message and emit the run.started →
   * message.created → run.completed event triple the UI expects for a
   * non-streaming reply. Returns the new message id.
   */
  const insertAssistantReply = async (
    userId: string,
    sessionId: string,
    replyText: string,
    timestamp: string,
    commandOutput?: StoredCommandOutput,
  ): Promise<string> => {
    const asstPayload: StoredMessagePayload = {
      id: randomUUID(),
      role: 'assistant',
      from: SYSTEM_PARTICIPANT,
      content: replyText,
      ...(commandOutput ? { uiOnly: true, commandOutput } : {}),
    }
    // Bracket the persist+message.created pair (shared helper) with the
    // run.started/run.completed envelope the UI expects for a non-streaming reply.
    streamRegistry.publish(userId, sessionId, {
      type: 'run.started',
      sessionId,
      messageId: asstPayload.id,
    })
    await persistAndPublishMessage(repo, streamRegistry, userId, sessionId, asstPayload, timestamp)
    streamRegistry.publish(userId, sessionId, {
      type: 'run.completed',
      sessionId,
      messageId: asstPayload.id,
      finishedAt: Date.now(),
      synthetic: true,
    })
    return asstPayload.id
  }

  /**
   * Insert a slash-command result without fabricating a conversation turn.
   * The optimistic command bubble/skeleton is swept by the synthetic run
   * envelope, while the durable result is projected as system chrome and is
   * excluded from model history via `uiOnly`.
   */
  const insertDirectReply = async (
    userId: string,
    sessionId: string,
    userPrompt: string,
    replyText: string,
    timestamp: string,
  ): Promise<MessageMutationResponse> => {
    const messageId = await insertAssistantReply(userId, sessionId, replyText, timestamp, {
      command: commandName(userPrompt),
      tone: commandTone(replyText),
    })

    return { sessionId, messageId }
  }

  /** Persist one compact system event; optionally bracket it to settle a standalone send. */
  const insertSystemNotice = async (
    userId: string,
    sessionId: string,
    notice: StoredSystemNotice,
    timestamp: string,
    settleOptimistic: boolean,
  ): Promise<MessageMutationResponse> => {
    const messageId = randomUUID()
    if (settleOptimistic) {
      streamRegistry.publish(userId, sessionId, {
        type: 'run.started',
        sessionId,
        messageId,
      })
    }
    await insertUiNote({
      repo,
      streamRegistry,
      now: () => timestamp,
      userId,
      sessionId,
      messageId,
      content: notice.text,
      systemNotice: notice,
    })
    if (settleOptimistic) {
      streamRegistry.publish(userId, sessionId, {
        type: 'run.completed',
        sessionId,
        messageId,
        finishedAt: Date.now(),
        synthetic: true,
      })
    }
    return { sessionId, messageId }
  }

  /**
   * Inserts a `/clear` context boundary. The boundary is a hidden internal user
   * message; future turns ignore everything before it.
   * A visible, model-invisible command result confirms the action to the user.
   */
  const insertContextBoundary = async (
    userId: string,
    sessionId: string,
    _session: SessionRecord,
    userPrompt: string,
    confirmText: string,
    timestamp: string,
  ): Promise<MessageMutationResponse> => {
    const boundaryPayload: StoredMessagePayload = {
      id: randomUUID(),
      role: 'user',
      from: USER_PARTICIPANT,
      content: userPrompt,
      isInternal: true,
      contextBoundary: true,
    }
    await persistAndPublishMessage(
      repo,
      streamRegistry,
      userId,
      sessionId,
      boundaryPayload,
      timestamp,
    )
    // A cleared view starts empty, so no checkpoint divider holds any more; an open transcript
    // would otherwise keep drawing one until it reloaded.
    streamRegistry.publish(userId, sessionId, {
      type: 'session_model_view.updated',
      sessionId,
      modelView: null,
    })

    const messageId = await insertAssistantReply(userId, sessionId, confirmText, timestamp, {
      command: commandName(userPrompt),
      tone: commandTone(confirmText),
    })
    return { sessionId, messageId }
  }

  return { insertAssistantReply, insertDirectReply, insertSystemNotice, insertContextBoundary }
}
