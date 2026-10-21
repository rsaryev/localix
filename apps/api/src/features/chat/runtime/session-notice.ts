/**
 * WHAT HAPPENED TO THIS CONVERSATION, said in the conversation — and said to the agents too.
 *
 * "@qa joined." "@lead is now on claude-opus-5." "@lead reasoning effort set to low." Every one
 * of these is a fact about the conversation that changes how the next turn should go, and until
 * now only the first of them reached the model: the other two were drawn by the client, as rows no
 * backend body contains, so they vanished on reload and no agent ever saw them.
 *
 * That asymmetry produced exactly the confusions it looks like it would. A participant whose
 * colleague left kept addressing them, because each participant's roster lives in a CACHED prompt
 * section that is rebuilt only when the participants change. A model moved from a small to a
 * large one was asked to continue as though nothing had happened, which is the one moment the
 * answer's shape genuinely changes. And a reasoning level raised mid-conversation looked, from
 * inside the transcript, like the same model suddenly thinking harder for no stated reason.
 *
 * So there is ONE writer here and every session event goes through it. The centred notice is
 * UI-only prose; its model-facing value is a resolved system context binding. At run intake
 * those bindings are reduced to current state and appended after the cacheable history prefix.
 *
 * Each line NAMES the participant it is about. A conversation may have several, and "Reasoning
 * effort set to low" in a conversation with three agents does not say whose — which is also true
 * of a private chat the moment its transcript is read by someone who was not there.
 */
import { randomUUID } from 'node:crypto'

import { SYSTEM_PARTICIPANT } from '../../../db'
import type { StoredSystemNotice } from '../../../db/payload'
import { PERMISSION_MODE_NOTICE, type PermissionMode } from '../../capabilities/permission-modes'
import type { AgentStreamEvent, PersistedMessage } from '../contracts'
import { toPersistedMessage } from './message-envelope'
import { noticeVisibility } from '../system-notice-audience'
import type { SessionAgentRoute } from '../repository-types'
import { systemNoticeBinding } from '../system-notice-bindings'

/** Everything a notice needs to be written and published. */
export interface SessionNoticeIo {
  repo: { insertMessage: (message: PersistedMessage) => Promise<void> }
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  now: () => string
}

/** The sentence, or nothing at all when the membership did not actually move. */
export function participantsChangeText(
  before: readonly SessionAgentRoute[],
  after: readonly SessionAgentRoute[],
): string | null {
  const had = new Set(before.map((member) => member.agentId))
  const has = new Set(after.map((member) => member.agentId))
  // Handles without @: a notice names agents, it does not address them, and the model copies the
  // host's usage — an @ written to credit a colleague hands that colleague a turn.
  const joined = after.filter((member) => !had.has(member.agentId)).map((m) => m.handle)
  const left = before.filter((member) => !has.has(member.agentId)).map((m) => m.handle)
  if (joined.length === 0 && left.length === 0) return null
  const parts: string[] = []
  // "joined" and "left" as separate clauses even in one edit: a swap is two facts, and a
  // sentence that merged them ("replaced X with Y") would claim an intent nobody stated.
  if (joined.length > 0) parts.push(`${joined.join(', ')} joined the conversation`)
  if (left.length > 0) parts.push(`${left.join(', ')} left the conversation`)
  return `${parts.join('; ')}.`
}

/** A model id without its provider prefix — what the picker and the transcript both call it. */
const shortModelName = (modelId: string): string => {
  const parts = modelId.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelId
}

/**
 * What changed about the people who STAYED: their model, their reasoning level.
 *
 * Only members present on both sides are compared. A newcomer's model is not a change — the
 * join line already says they are here, and the roster the next turn is built from carries what
 * they run on.
 *
 * The connection is deliberately absent: which credentials a model is reached through is an
 * account fact, not something the conversation can act on, and naming it to the model would be
 * noise it cannot use.
 */
export function routeChangeNotices(
  before: readonly SessionAgentRoute[],
  after: readonly SessionAgentRoute[],
): StoredSystemNotice[] {
  const previous = new Map(before.map((member) => [member.agentId, member]))
  const notices: StoredSystemNotice[] = []
  for (const member of after) {
    const was = previous.get(member.agentId)
    if (!was) continue
    const who = member.handle
    if (member.modelId && was.modelId !== member.modelId) {
      notices.push({
        kind: 'model_change',
        tone: 'neutral',
        participant: member.handle,
        text: `${who} is now on ${shortModelName(member.modelId)}.`,
      })
    }
    if (member.reasoningEffort && was.reasoningEffort !== member.reasoningEffort) {
      notices.push({
        kind: 'reasoning_change',
        tone: 'neutral',
        participant: member.handle,
        // The effort tier IS its own display label (`off`/`minimal`/`low`/…), so there is
        // nothing to map.
        text: `${who} reasoning effort set to ${member.reasoningEffort}.`,
      })
    }
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
        from: SYSTEM_PARTICIPANT,
        content: notice.text,
        bindings: [systemNoticeBinding(notice, messageId, createdAt)],
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

/**
 * Everything one edit changed about the conversation, as lines in it — the membership first,
 * then what the people who stayed now run on.
 *
 * In that order because that is the order it reads: who is here, and then what they are working
 * with. One call site (`updateSession`), so the two halves cannot be announced by different
 * writers or drift into different sentences.
 */
export async function announceSessionChanges(
  io: SessionNoticeIo,
  userId: string,
  sessionId: string,
  before: ConversationShape,
  after: ConversationShape,
): Promise<void> {
  const change = participantsChangeText(before.agents, after.agents)
  const mode = permissionModeChangeNotice(before.permissionMode, after.permissionMode)
  const notices: StoredSystemNotice[] = [
    ...(change
      ? [{ kind: 'participants_change' as const, tone: 'neutral' as const, text: change }]
      : []),
    ...routeChangeNotices(before.agents, after.agents),
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
 * The fact about a conversation that a session edit can change and the participants must hear:
 * who is in it, on what each of them runs, and under which permission mode. A `SessionRecord`
 * satisfies it, so the caller passes the record before and after the write.
 */
export interface ConversationShape {
  agents: readonly SessionAgentRoute[]
  permissionMode?: PermissionMode
}
