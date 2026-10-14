import type { WakeSource } from '../contracts'
import type { AgentTurnSource } from './conversation-strategy'

/**
 * WHO RUNS NEXT IN ONE SESSION. Lower runs first.
 *
 * Bands, in order:
 *
 *   answers owed to the person   (their message's addressed, default and broadcast turns)  < 0
 *   the person's next message                                                            = 0
 *   a colleague chain            (one participant handing the floor to another)          > 0
 *   machine wakes                (loops, jobs, reports, hooks)                           = 10
 *
 * The chain used to sit BELOW the person's message and every dispatch aged it further down, so
 * a message typed during a long handoff chain waited for the whole chain: the person could not
 * interrupt their own conversation. Now a queued message outranks any chain, and aging moves a
 * chain ticket only within its own band.
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
  'user-address': -8,
  'user-default': -8,
  // After the addressed participants, still before the person's next message.
  'user-broadcast': -6,
  runtime: -8,
  'agent-request': 4,
}

/**
 * The lowest priority aging may push a ticket to. A chain ticket never crosses into the band of
 * the person's message; the answers owed to the person have no floor among themselves.
 */
export function agentTurnFloor(source: AgentTurnSource): number {
  return source === 'agent-request' ? QUEUE_PRIORITY.user + 1 : Number.NEGATIVE_INFINITY
}

/** One aging step: every dispatch moves a waiting ticket forward, within its band. */
export function agedPriority(source: AgentTurnSource, priority: number): number {
  return Math.max(agentTurnFloor(source), priority - 1)
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
