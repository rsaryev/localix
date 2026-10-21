import type { AgentTurnAdmission } from '../agent-turn-ticket'
import type { AgentTurnSource } from '../conversation-strategy'
import type { WakeQueueContext } from '../wake-queue-contracts'
import type { WakeQueueStore } from '../wake-queue-repository'
import type { ContinuationOperations } from './continuations'
import type { DeadLetter } from './dead-letter'
import type { PendingTurn } from './entry'
import type { HeldEntries } from './holds'
import type { LeaseOperations } from './leases'
import type { AgentTurnFilter } from './agent-turns'

export interface DrainOptions {
  ownsDrainLease?: boolean
  preferredItemId?: string
  preclaimedItemId?: string
}

export interface DrainDependencies extends Pick<
  WakeQueueContext,
  | 'repo'
  | 'streamRegistry'
  | 'now'
  | 'state'
  | 'run'
  | 'onError'
  | 'leadership'
  | 'floorAdvisor'
  | 'inviteAddressed'
> {
  enqueueRun: (turn: AgentTurnAdmission, source: AgentTurnSource) => Promise<void>
  store?: WakeQueueStore<PendingTurn>
  ready: Promise<void>
  leases: LeaseOperations
  continuations: ContinuationOperations
  publishQueue: (userId: string, sessionId: string) => void
  ageWaitingAgentTurns: (userId: string, sessionId: string) => Promise<void>
  cancelAgentTurns: (userId: string, sessionId: string, filter: AgentTurnFilter) => Promise<void>
  /** What may not open a turn yet (`holds.ts`). */
  holdsOf: (sessionId: string) => HeldEntries
  /** Drain `sessionId` again at `atMs`, when its earliest held entry is released by age. */
  holdUntil: (sessionId: string, atMs: number) => void
  /** Parks a band that failed every retry (`dead-letter.ts`). */
  deadLetter: DeadLetter
}
