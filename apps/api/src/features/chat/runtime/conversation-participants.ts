/**
 * THE ONE WRITER OF A CONVERSATION'S MEMBERSHIP.
 *
 * Membership changed through two doors — the composer's session patch and an agent's
 * invitation — and only the first one did the work around the write. The agent
 * door could remove the participant that was speaking, left the removed participant's queued
 * turns to run, and announced nothing, so the other participants kept addressing someone who
 * had left. Both doors also wrote a list read earlier with no check that it was still current,
 * so a composer edit could silently erase an invitation that landed in between.
 *
 * So every membership change comes here, and the steps are fixed:
 *
 *   read the current session → decide the new list → refuse removing the active speaker →
 *   write only if unchanged since the read → cancel the removed participants' queued turns →
 *   announce who came and went → publish.
 *
 * Routes are never written here: a participant who stays keeps what it runs on
 * (`writeMembership`), and a re-route is its own verb.
 */
import { ApiError } from '../../../lib/errors'
import type { AgentStreamEvent, PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import type { SessionAgentRoute } from '../repository-types'
import { recordSessionChanges } from './session-notice'

export interface ParticipantsIo {
  repo: {
    getSession: (userId: string, id: string) => Promise<SessionRecord | null>
    updateMembership: (
      userId: string,
      id: string,
      agents: SessionAgentRoute[],
      stamp: { updatedAt: string; expectedUpdatedAt?: string },
    ) => Promise<boolean>
    insertMessage: (message: PersistedMessage) => Promise<void>
  }
  streamRegistry: {
    publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void
  }
  now: () => string
  /** Tell clients about the stored result; each door has its own way (the session layer's). */
  publishSession: (session: SessionRecord) => void
  /** The participant running right now, if any; it cannot be removed mid-turn. */
  activeAgentId?: (sessionId: string) => string | undefined
  cancelAgentTurn?: (userId: string, sessionId: string, agentId: string) => Promise<void>
}

export interface ParticipantsChange {
  before: SessionRecord
  after: SessionRecord
  joined: SessionAgentRoute[]
  left: SessionAgentRoute[]
}

export async function changeParticipants(
  io: ParticipantsIo,
  input: {
    userId: string
    sessionId: string
    /** The new list, decided from the session as read now. */
    decide: (current: SessionRecord) => SessionAgentRoute[] | Promise<SessionAgentRoute[]>
    /** The `updatedAt` the caller's view was built from; a newer session refuses the write. */
    expectedUpdatedAt?: string
  },
): Promise<ParticipantsChange> {
  const before = await io.repo.getSession(input.userId, input.sessionId)
  if (!before) throw new ApiError(404, 'session_not_found', 'Conversation no longer exists')
  const next = await input.decide(before)
  if (next.length === 0)
    throw new ApiError(
      400,
      'session_party_empty',
      'A conversation must keep at least one participant',
    )

  const kept = new Set(next.map((member) => member.agentId))
  const had = new Set(before.agents.map((member) => member.agentId))
  const joined = next.filter((member) => !had.has(member.agentId))
  const left = before.agents.filter((member) => !kept.has(member.agentId))
  if (joined.length === 0 && left.length === 0 && sameOrder(before.agents, next)) {
    return { before, after: before, joined, left }
  }

  const active = io.activeAgentId?.(input.sessionId)
  if (active && left.some((member) => member.agentId === active))
    throw new ApiError(409, 'agent_running', 'Stop the active agent before removing it')

  const written = await io.repo.updateMembership(input.userId, input.sessionId, next, {
    updatedAt: io.now(),
    ...(input.expectedUpdatedAt !== undefined
      ? { expectedUpdatedAt: input.expectedUpdatedAt }
      : {}),
  })
  if (!written)
    throw new ApiError(
      409,
      'session_changed',
      'The conversation changed since it was loaded; reload and try again',
    )

  if (io.cancelAgentTurn)
    await Promise.all(
      left.map((member) => io.cancelAgentTurn!(input.userId, input.sessionId, member.agentId)),
    )
  // Read back what was stored, resolved: a newcomer's route is blank on purpose, and publishing
  // the in-memory list would show it with no model until the next read.
  const after = (await io.repo.getSession(input.userId, input.sessionId)) ?? before
  // After the write is durable, so a failed change never announces something that did not
  // happen. The lines are model-visible on purpose: see `session-notice.ts`.
  await recordSessionChanges(io, input.userId, input.sessionId, before, after)
  io.publishSession(after)
  return { before, after, joined, left }
}

function sameOrder(a: readonly SessionAgentRoute[], b: readonly SessionAgentRoute[]): boolean {
  return a.length === b.length && a.every((member, index) => member.agentId === b[index]?.agentId)
}
