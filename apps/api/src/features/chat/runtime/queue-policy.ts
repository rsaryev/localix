import type { WakeSource } from '../contracts'
import type { AgentTurnSource } from './conversation-strategy'

/**
 * WHO RUNS NEXT IN ONE SESSION. Lower runs first.
 *
 * Bands, in order:
 *
 *   answers owed to the person   (their message's turn, and runtime deliveries)  < 0
 *   the person's next message                                                    = 0
 *   machine wakes                (loops, jobs, reports, hooks)                   = 10
 *
 * A queued message outranks any machine wake, so the person can always interrupt.
 */
export type QueueSource =
  | { kind: 'user' }
  | { kind: 'control' }
  | { kind: 'wake'; producer: WakeSource | undefined }
  | { kind: 'agent-turn'; producer: AgentTurnSource }

export const QUEUE_PRIORITY = {
  user: 0,
  wake: 10,
} as const

/** Each source's priority when its ticket is admitted. */
const AGENT_TURN_PRIORITY: Readonly<Record<AgentTurnSource, number>> = {
  'user-default': -8,
  runtime: -8,
}

export interface QueuePolicy {
  priority(source: QueueSource): number
}

export const defaultQueuePolicy: QueuePolicy = {
  priority(source) {
    if (source.kind === 'agent-turn') return AGENT_TURN_PRIORITY[source.producer]
    if (source.kind !== 'wake') return QUEUE_PRIORITY.user
    if (source.producer === 'user-busy' || source.producer === 'user-steer')
      return QUEUE_PRIORITY.user
    return QUEUE_PRIORITY.wake
  },
}
