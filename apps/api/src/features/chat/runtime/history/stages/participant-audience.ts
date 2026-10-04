/**
 * WHAT ONE PARTICIPANT IS SHOWN OF A SHARED TRANSCRIPT.
 *
 * The rules `participant-view` applies, stated as data and as three small predicates, so that
 * the stage stays a loop and each rule can be read — and tested — on its own. Every rule here
 * exists because of something a participant did without it; the comment on each says what.
 *
 * All of them are PURE and TOTAL: same transcript plus same audience always yields the same
 * bytes. The prompt cache depends on it — a participant's prefix has to be reproducible across
 * its turns, so nothing here may consult a clock, a registry, or anything outside its arguments.
 */
import { isToolBackedItem } from '@localixai/agent/agents'
import type { StoredMessagePayload } from '../../../../../db/payload'
import { isAgentParticipant } from '../../../../../db/participant'
import type { SessionRecord } from '../../../repository'
import { sessionAgent } from '../../message-envelope'

/**
 * The audience for every session's run, including a conversation with one remaining agent.
 *
 * Here rather than at the caller so the two halves of one rule sit together: who reads the
 * transcript, and the roster their own rows are gated to.
 */
export function participantAudienceFor(
  session: SessionRecord,
  toolNames: readonly string[],
  agentId?: string,
): ParticipantAudience {
  return { viewer: sessionAgent(session, agentId), tools: new Set(toolNames) }
}

/** Who the projection is for, and what that participant can actually do this turn. */
export interface ParticipantAudience {
  /** The participant whose turn this is, as a `ParticipantRef`. */
  viewer: string
  /**
   * The tool names this run is actually holding — `runtimeTools.toolNames`, post-profile,
   * post-capability, post-plugin. Absent means "do not gate", which is what every caller outside
   * a run wants.
   */
  tools?: ReadonlySet<string>
}

/**
 * Is this row something a participant SAID, rather than something the system routed in?
 *
 * The distinction decides how `to` is honoured below: speech is broadcast — a conversation
 * hears its participants even when they address one of their own — while routed data is
 * addressed, and delivering it to everyone is the same report paid for once per participant.
 */
export function isSpokenRow(payload: StoredMessagePayload): boolean {
  return typeof payload.from === 'string' && isAgentParticipant(payload.from)
}

/**
 * A row this participant should not be reading at all.
 *
 * Two kinds, and neither is a message:
 *
 *   - Another participant's SILENT turn, or an empty usage-only row. The author's own structured
 *     work remains context even when there was no public reply.
 *   - A FAILED turn. Its `content` is the error, which is the right reply when one agent is
 *     talking to the user and a lie to everyone else: observed, participants answered "Agent is
 *     unavailable" as a colleague's contribution. The row says so structurally (`failed`), so
 *     nothing here reads error prose.
 */
export function isUnreadableRow(payload: StoredMessagePayload, viewer: string): boolean {
  if (isSpokenRow(payload) && payload.isInternal && payload.role === 'assistant') {
    // Silence hides the public reply, not the author's useful tool history. Empty usage-only
    // rows remain excluded, so the provider never receives an empty assistant turn.
    return payload.from !== viewer || !payload.items?.length
  }
  return payload.failed === true && payload.from !== viewer
}

/**
 * Replay available tools structurally; retain other results as historical observations.
 *
 * A participant's own rows carry its own tool calls, and they are the most load-bearing context
 * it has — what it read, what it edited, what failed. But a model reads its own history as proof
 * of what it can do, so a call to a tool the run is not holding is an invitation to hallucinate
 * that tool back into existence. Observed live from the other direction: two
 * participants with no preview tool told the user "the interactive browser is blocked in this
 * session", and the next one opened it and played — they had inferred a capability from the
 * conversation's talk.
 *
 * This applies to every tool-backed item, including shell commands and MCP calls. Turning an
 * unavailable call into text preserves the work without advertising an executable capability.
 */
export function gateToolItems(
  items: StoredMessagePayload['items'],
  tools: ReadonlySet<string> | undefined,
): StoredMessagePayload['items'] {
  if (!tools || !Array.isArray(items)) return items
  let changed = false
  const kept = items.flatMap((item) => {
    if (!isToolBackedItem(item) || tools.has(item.name)) return [item]
    changed = true
    const result = item.error?.userMessage ?? item.resultText ?? item.errorText
    if (!result) return []
    return [
      {
        id: item.id,
        type: 'text' as const,
        status: 'completed' as const,
        turnIndex: item.turnIndex,
        text: `Historical observation from unavailable tool ${JSON.stringify(item.name)}:\n${result}`,
      },
    ]
  })
  return changed ? kept : items
}

/**
 * How another participant's reply is introduced to the viewer.
 *
 * A name and a colon, the way every chat transcript in the world writes one, because the model
 * has read millions of them and needs no instruction to parse this. The handle comes from the
 * snapshot frozen at insert (`authorSnapshot`), never re-resolved: a renamed agent must not
 * retro-author what it said under its old name, and a re-resolution would also change the bytes
 * of an already-cached prefix.
 */
export function speakerLine(payload: StoredMessagePayload, text: string): string {
  const handle = payload.authorSnapshot?.handle
  return handle ? `${handle}: ${text}` : text
}

/**
 * The one line the other participants get instead of a report routed to one of them.
 * No excerpt: even the first character of an addressed result may contain private work.
 *
 * Not a drop, because a participant that cannot see that the work was answered at all will ask for
 * the same work again. Not the whole thing either: in one live room nine routed reports came to
 * 13.9k characters, delivered whole to all four participants, about work belonging to one — for
 * two of them that was more text than everything their colleagues actually said.
 */
export function routedNote(payload: StoredMessagePayload): string {
  const recipient = payload.toSnapshot?.handle
  return recipient
    ? `[Result delivered to ${JSON.stringify(recipient)}.]`
    : '[Result delivered to another participant.]'
}

/** Visible text of a message, ignoring structured items. */
export function spokenText(payload: StoredMessagePayload): string {
  return typeof payload.content === 'string' ? payload.content.trim() : ''
}
