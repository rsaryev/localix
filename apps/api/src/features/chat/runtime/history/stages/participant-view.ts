/**
 * THE CONVERSATION AS ONE PARTICIPANT SEES IT.
 *
 * A conversation is one transcript that several agents share, and a transcript is not
 * symmetric: every model reads `assistant` as "words I said". Hand a participant the transcript
 * verbatim and its colleagues' replies arrive as its own prior turns — so it continues them,
 * defends them, and reports work it never did. That is the failure this stage exists to prevent.
 * Giving each participant its own session or its own copy of the conversation would avoid it, but
 * then there are two records of one conversation and the job of keeping them in step.
 *
 * A projection buys the same result without the second record. The conversation keeps ONE
 * transcript; each participant's run reads it through this stage, which rewrites it for them:
 *
 *   the viewer's own rows           → assistant; unavailable tools become historical observations
 *   the user's rows                 → user, untouched
 *   another participant's reply     → user, prefixed with who said it
 *   another participant's tool work → dropped
 *   data routed to someone else     → one attributed line
 *   own silent tool work            → retained
 *   other silent/failed turns       → dropped
 *
 * Dropping the colleagues' tool traffic is not tidying. A tool call is an ACTION with an actor,
 * and an action attributed to the wrong actor is worse than a missing one: a participant that
 * reads a colleague's file edits as context will describe them as its own, and one that reads a
 * colleague's failed command will retry work that already succeeded. What a participant needs
 * from a colleague is what the colleague SAID, which is exactly what stays.
 *
 * Each rule lives in `participant-audience.ts` with the observation that forced it; this file is
 * the loop that applies them, in one pass, with no lookups.
 *
 * Membership can shrink to one without deleting the old transcript. Projection therefore
 * applies to every session: a departed participant's work must never become the survivor's own.
 */
import type { HistoryStage } from '@localixai/agent/history'

import type { PersistedMessage } from '../../../contracts'
import {
  gateToolItems,
  isSpokenRow,
  isUnreadableRow,
  routedNote,
  speakerLine,
  spokenText,
  type ParticipantAudience,
} from './participant-audience'

export { speakerLine } from './participant-audience'
export type { ParticipantAudience } from './participant-audience'

/**
 * Rewrite one conversation transcript into the view of one participant.
 *
 * Pure and total: every input row maps to exactly one output row or to none, with no lookups,
 * so the same history and the same audience always produce the same bytes. The prompt cache
 * depends on that — a participant's prefix must be reproducible across its turns.
 */
export function projectParticipantView(
  messages: readonly PersistedMessage[],
  audience: ParticipantAudience,
): PersistedMessage[] {
  const { viewer, tools } = audience
  const out: PersistedMessage[] = []
  for (const message of messages) {
    const payload = message.payload
    if (isUnreadableRow(payload, viewer)) continue

    // The viewer's own row: preserve its work, with unavailable calls represented as historical
    // observations. This is the only branch that keeps structured assistant items.
    if (payload.from === viewer) {
      const items = gateToolItems(payload.items, tools)
      if (payload.isInternal && !payload.content?.trim() && !items?.length) continue
      out.push(items === payload.items ? message : { ...message, payload: { ...payload, items } })
      continue
    }

    // Data routed to ONE participant — a board outcome, a finished child's report. Speech is
    // broadcast and a conversation hears its participants address each other, so this narrowing
    // applies only to rows no participant spoke.
    if (payload.to && payload.to !== viewer && !isSpokenRow(payload)) {
      const text = spokenText(payload)
      if (!text) continue
      out.push({
        ...message,
        payload: {
          ...payload,
          content: routedNote(payload),
          items: undefined,
          bindings: undefined,
        },
      })
      continue
    }

    // Anything else the viewer did not write and that is not an agent's line — the person's own
    // messages, and data addressed to this viewer — passes through as it stands.
    if (!isSpokenRow(payload)) {
      out.push(message)
      continue
    }

    // Another participant: keep what it SAID, drop what it DID.
    const text = spokenText(payload)
    if (!text) continue
    out.push({
      ...message,
      payload: {
        ...payload,
        role: 'user',
        content: speakerLine(payload, text),
        items: undefined,
      },
    })
  }
  return out
}

/**
 * The stage. Callers materializing an unscoped history can omit the audience; production runs
 * supply the executor's audience regardless of the current membership count.
 */
export function participantViewStage(
  audience?: ParticipantAudience,
): HistoryStage<PersistedMessage> {
  return {
    name: 'participant-view',
    // Load-bearing, not advisory: if the rewrite fails and the pipeline shrugs, the participant
    // is handed its colleagues' replies as its own words — the exact confusion this stage exists
    // to stop. A broken rule must stop the turn, the way the boundary cut does.
    run: (messages) => {
      if (!audience) return { messages }
      return { messages: projectParticipantView(messages as PersistedMessage[], audience) }
    },
  }
}
