import type { ToolSurface } from '@localixai/agent/agents'

import type { ParticipantRef } from '../../../db'
import type { MessageBinding, WakeSource } from '../contracts'
import type { ChatRepository, SessionRecord } from '../repository'
import type { RuntimeState } from './agent-runner-state'
import type { AgentTurnTicket } from './agent-turn-ticket'
import type { LeadershipPriorities } from './conversation-strategy'
import type { RunExecutionContext } from './execution-context'
import type { QueuePolicy } from './queue-policy'
import type { RunExecutionOutcome, RunCompletion } from './run-outcome'
import type { RunIdentity, RunParams } from './run-contract'
import type { SessionStreamRegistry } from './session-stream-registry'
import type { PendingTurn } from './wake-queue/leases'
import type { WakeQueueStore } from './wake-queue-store'

export interface WakeQueueContext {
  policy?: QueuePolicy
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  state: Pick<RuntimeState, 'activeRuns' | 'drainingSessions' | 'sessionRunIdentity'>
  run: (params: RunParams) => Promise<RunExecutionOutcome>
  onError?: (error: unknown) => void
  store?: WakeQueueStore<PendingTurn>
  /** Who leads a conversation that has not yet been answered; absent means party order. */
  leadership?: (userId: string, projectId: string | null) => LeadershipPriorities
}

export interface EnqueueParams {
  deliveryKey?: string
  /** Admit `deliveryKey` once ever — see `WakeRequest.receipt`. */
  receipt?: true
  agentTurn?: AgentTurnTicket
  userId: string
  session: SessionRecord
  content: string
  clientMessageId?: string
  extraDisabledTools?: string[]
  /** Plugins whose tools the answering turn carries (`WakeRequest.plugin`). */
  plugins?: string[]
  internal?: boolean
  source?: WakeSource
  bindings?: MessageBinding[]
  toolSurface?: ToolSurface
  executionContext?: RunExecutionContext
  to?: { participant: ParticipantRef; handle?: string }
  /** Route as the person's message with this text (`WakeRequest.addressedAs`). */
  addressedAs?: string
  command?: QueuedCommand
}

/**
 * A slash command that arrived while its session was busy, kept WHOLE until its turn.
 *
 * Without it a busy command had two bad choices: write its user row and slot into the middle
 * of the running turn, or queue as plain text and lose what made it a command — the badge, the
 * one-run model, the skill's tool grants and hooks. Serializable, because the row is durable.
 */
export interface QueuedCommand {
  origin?: { command: string; label: string }
  identity?: Pick<
    RunIdentity,
    'extraAllowedTools' | 'requiredTools' | 'ccScopedHooks' | 'modelOverride'
  >
}

export interface WakeOptions {
  waitForCompletion?: boolean
  continuation?: RunCompletion
}
