/**
 * WHAT HAPPENED TO THIS CONVERSATION, said in the conversation — and said to the agent too.
 *
 * "lead is now on claude-opus-5." "lead reasoning effort set to low." Every one of these is a
 * fact about the conversation that changes how the next turn should go. A model moved from a
 * small to a large one was asked to continue as though nothing had happened, which is the one
 * moment the answer's shape genuinely changes, and a reasoning level raised mid-conversation
 * looked, from inside the transcript, like the same model suddenly thinking harder.
 *
 * So there is ONE writer here and every session event goes through it. The centred notice is
 * UI-only prose; its model-facing value is a resolved system context binding. At run intake
 * those bindings are reduced to current state and appended after the cacheable history prefix.
 */
import { randomUUID } from 'node:crypto'

import { SYSTEM_AUTHOR } from '../../../db'
import type { StoredSystemNotice } from '../../../db/payload'
import { PERMISSION_MODE_NOTICE, type PermissionMode } from '../../../contracts/permission-modes'
import type { AgentStreamEvent, PersistedMessage } from '../contracts'
import { toPersistedMessage } from './message-envelope'
import { noticeVisibility } from '../system-notice-audience'
import type { SessionAgentRoute } from '../repository-types'
import { carriesModelContext, systemNoticeBinding } from '../system-notice-bindings'

/** Everything a notice needs to be written and published. */
export interface SessionNoticeIo {
  repo: { insertMessage: (message: PersistedMessage) => Promise<void> }
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  now: () => string
}

/** A model id without its provider prefix — what the picker and the transcript both call it. */
const shortModelName = (modelId: string): string => {
  const parts = modelId.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelId
}

/**
 * What changed about the conversation's agent: its model, its reasoning level.
 *
 * Only an agent present on both sides is compared; a first assignment is not a change.
 *
 * The connection is deliberately absent: which credentials a model is reached through is an
 * account fact, not something the conversation can act on, and naming it to the model would be
 * noise it cannot use.
 */
export function routeChangeNotices(
  before: SessionAgentRoute | null,
  after: SessionAgentRoute | null,
): StoredSystemNotice[] {
  if (!before || !after || before.agentId !== after.agentId) return []
  const notices: StoredSystemNotice[] = []
  const who = after.name
  if (after.modelId && before.modelId !== after.modelId) {
    notices.push({
      kind: 'model_change',
      tone: 'neutral',
      text: `${who} is now on ${shortModelName(after.modelId)}.`,
    })
  }
  if (after.reasoningEffort && before.reasoningEffort !== after.reasoningEffort) {
    notices.push({
      kind: 'reasoning_change',
      tone: 'neutral',
      // The effort tier IS its own display label (`off`/`minimal`/`low`/…), so there is
      // nothing to map.
      text: `${who} reasoning effort set to ${after.reasoningEffort}.`,
    })
  }
  return notices
}

/**
 * Write one line into the conversation and publish it.
 *
 * Best-effort: a change that succeeded must not fail because its announcement did. What it is
 * about is already durable by the time this runs, so the worst case is a change that happened
 * without a line saying so — which is what the product did before this existed.
 */
export async function recordSessionNotice(
  io: SessionNoticeIo,
  userId: string,
  sessionId: string,
  notice: StoredSystemNotice,
): Promise<void> {
  try {
    const messageId = randomUUID()
    const createdAt = io.now()
    const message = toPersistedMessage(
      userId,
      sessionId,
      {
        id: messageId,
        role: 'user',
        from: SYSTEM_AUTHOR,
        content: notice.text,
        ...(carriesModelContext(notice)
          ? { bindings: [systemNoticeBinding(notice, messageId, createdAt)] }
          : {}),
        // The same visibility rule the runtime writer uses: prose stays in the transcript while
        // the binding above carries the fact into deduplicated model context.
        ...noticeVisibility(notice),
        systemNotice: notice,
      },
      createdAt,
    )
    await io.repo.insertMessage(message)
    io.streamRegistry.publish(userId, sessionId, {
      type: 'message.created',
      sessionId,
      message,
    })
  } catch (error) {
    console.warn('[session] could not record a session notice', error)
  }
}

/** Everything one edit changed about the conversation, as lines in it. */
export async function announceSessionChanges(
  io: SessionNoticeIo,
  userId: string,
  sessionId: string,
  before: ConversationShape,
  after: ConversationShape,
): Promise<void> {
  const mode = permissionModeChangeNotice(before.permissionMode, after.permissionMode)
  const notices: StoredSystemNotice[] = [
    ...routeChangeNotices(before.agent, after.agent),
    ...(mode ? [mode] : []),
  ]
  for (const notice of notices) await recordSessionNotice(io, userId, sessionId, notice)
}

/** The mode line, or nothing when the mode did not actually move (a re-sent same value). */
export function permissionModeChangeNotice(
  before: PermissionMode | undefined,
  after: PermissionMode | undefined,
): StoredSystemNotice | null {
  if (after === undefined || before === after) return null
  // The mode travels beside the prose so the client can draw the line in that mode's own
  // icon and tone — the text alone cannot tell a switch to Autonomous from one back to Default.
  return {
    kind: 'permission_mode_change',
    tone: 'info',
    text: PERMISSION_MODE_NOTICE[after],
    mode: after,
  }
}

/**
 * What a session edit can change and the agent must hear: what it runs on, and under which
 * permission mode. A `SessionRecord` satisfies it, so the caller passes the record before and
 * after the write.
 */
export interface ConversationShape {
  agent: SessionAgentRoute | null
  permissionMode?: PermissionMode
}
