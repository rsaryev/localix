/**
 * Seeds this run's mutable RunTurnState from the history its caller already
 * loaded plus one point-read of the assistant record. The point read preserves a
 * partially-written payload on transient retries without re-querying and mapping
 * the complete active branch a second time at every run start.
 */
import { deriveSessionTiming, emptySessionTiming } from '../../session-timing'
import type { AuthorRef } from '../../../../db'
import type { ChatRepository } from '../../repository'
import type { PersistedMessage } from '../../contracts'
import { createRunTurnState, type RunTurnState } from './turn-state'
import { emptyAssistantPayload } from '../message-envelope'

export interface PreparedTurnState {
  state: RunTurnState
  /** Idle gap (ms) before this turn — between the trigger message and the prior turn's tail. */
  turnIdleMs: number
}

export async function prepareTurnState(args: {
  repo: ChatRepository
  userId: string
  sessionId: string
  /** Who authors the response row when it has to be seeded here — the session's agent. */
  agent: AuthorRef
  assistantMessageId: string
  historyMessages: PersistedMessage[]
  now: () => string
}): Promise<PreparedTurnState> {
  const { repo, userId, sessionId, agent, assistantMessageId, historyMessages, now } = args

  const assistantRecord = await repo.getMessage(userId, sessionId, assistantMessageId)
  const assistantCreatedAt = assistantRecord?.createdAt ?? now()

  // RunTurnState: this run's explicit mutable state — streaming payload,
  // timing telemetry, usage totals, pending tools, key/fallback tracking.
  const state = createRunTurnState({
    payload: assistantRecord?.payload ?? emptyAssistantPayload(assistantMessageId, agent),
    assistantCreatedAt,
    baseSessionTiming: emptySessionTiming(),
  })

  // Base aggregate from previously-timed messages in this session (excludes
  // the assistant message we're now producing), so live updates show the total.
  state.baseSessionTiming =
    deriveSessionTiming(historyMessages.map((m) => m.payload)) ?? emptySessionTiming()

  // Idle gap before this turn = how long the session sat between the previous
  // turn and the message that triggered this run. Reported to the runtime as
  // `promptCacheIdleMs`; the adapter turns it into a provider cache TTL (a slow
  // cadence — a /loop, a parked worker — is worth a longer-lived cache). The two
  // latest prior messages are this turn's trigger (~now) and the previous turn's tail.
  const recentTwo = historyMessages
    .flatMap((m) => {
      const t = Date.parse(m.createdAt)
      return Number.isFinite(t) ? [t] : []
    })
    .sort((a, b) => b - a)
    .slice(0, 2)
  const turnIdleMs = recentTwo.length === 2 ? Math.max(0, recentTwo[0] - recentTwo[1]) : 0

  return { state, turnIdleMs }
}
