import type { SessionRecord } from '../repository'
import type { RunScope } from './run-contract'
import type { RunCompletion } from './run-outcome'
import type { AgentTurnSource } from './conversation-strategy'

/** Serializable execution intent. History is read when dispatched, never copied into tickets. */
export interface AgentTurnTicket {
  speakerAgentId: string
  assistantMessageId: string
  /** All events merged into this one pending address, oldest first. */
  triggerMessageIds: readonly string[]
  source: AgentTurnSource
  scope: RunScope
}

/**
 * What a producer states to admit one addressed turn — the enqueue input.
 *
 * It carries no history. The dispatcher re-reads the transcript when the ticket runs
 * (`wake-queue/dispatch-agent.ts`), so a history array handed to the enqueue was read only for
 * the id of its last row, and every producer had to build one just to say which row opened the
 * turn. Each producer already holds that id, so it states it directly.
 */
export interface AgentTurnAdmission {
  userId: string
  session: SessionRecord
  /** The assistant row this turn fills. */
  assistantMessageId: string
  /** The rows that opened the turn (the user row, or the handing-off assistant row). */
  triggerMessageIds: readonly string[]
  scope: RunScope
  /** Settled when the admitted run reaches a terminal state. */
  completion?: RunCompletion
}

export type EnqueueRun = (turn: AgentTurnAdmission, source: AgentTurnSource) => Promise<unknown>
