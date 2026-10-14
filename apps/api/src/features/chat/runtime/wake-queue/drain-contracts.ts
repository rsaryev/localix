import type { AgentTurnAdmission } from '../agent-turn-ticket'
import type { AgentTurnSource } from '../conversation-strategy'
import type { WakeQueueContext } from '../wake-queue-contracts'
import type { WakeQueueStore } from '../wake-queue-store'
import type { ContinuationOperations } from './continuations'
import type { LeaseOperations, PendingTurn } from './leases'
import type { AgentTurnFilter } from './agent-turns'

export interface DrainOptions {
  ownsDrainLease?: boolean
  preferredItemId?: string
  preclaimedItemId?: string
}

export interface DrainDependencies extends Pick<
  WakeQueueContext,
  'repo' | 'streamRegistry' | 'now' | 'state' | 'run' | 'onError' | 'leadership' | 'inviteAddressed'
> {
  enqueueRun: (turn: AgentTurnAdmission, source: AgentTurnSource) => Promise<void>
  store?: WakeQueueStore<PendingTurn>
  ready: Promise<void>
  leases: LeaseOperations
  continuations: ContinuationOperations
  publishQueue: (userId: string, sessionId: string) => void
  ageWaitingAgentTurns: (userId: string, sessionId: string) => Promise<void>
  cancelAgentTurns: (userId: string, sessionId: string, filter: AgentTurnFilter) => Promise<void>
}
