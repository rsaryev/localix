import type { ToolSurface } from '@localixai/agent/agents'

import type { DelegatedReport, MessageBinding, WakeSource } from '../contracts'
import type { ChatRepository, SessionRecord } from '../repository'
import type { RuntimeState } from './agent-runner-state'
import type { AgentTurnTicket } from './agent-turn-ticket'
import type { RunExecutionContext } from './execution-context'
import type { QueuePolicy } from './queue-policy'
import type { RunExecutionOutcome, RunCompletion } from './run-outcome'
import type { RunIdentity, RunParams } from './run-contract'
import type { SessionStreamRegistry } from './session-stream-registry'
import type { PendingTurn } from './wake-queue/entry'
import type { WakeQueueStore } from './wake-queue-repository'

export interface WakeQueueContext {
  policy?: QueuePolicy
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  state: Pick<RuntimeState, 'activeRuns' | 'drainingSessions' | 'sessionRunIdentity'>
  run: (params: RunParams) => Promise<RunExecutionOutcome>
  onError?: (error: unknown) => void
  store?: WakeQueueStore<PendingTurn>
  /** Durable lease length, renewed while a delivery step runs (default 60s; tests shorten it). */
  leaseMs?: number
  /** Arms the retry of a failed drain (default `setTimeout`); tests fire it by hand. */
  armDrainRetry?: (fire: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** Whether a delegator still waits on children at work; absent, a report never waits. */
  reportBarrier?: ReportBarrier
}

/**
 * WHAT A CHILD'S REPORT WAITS FOR: the other children its delegator handed work to.
 *
 * A port, because the fact lives with delegation (`agent-core/delegation-awaits.ts`) and the queue
 * only needs to ask it — and to hear when it changes, so a report held for a sibling is delivered
 * the moment that sibling settles, not at the next unrelated wake.
 */
export interface ReportBarrier {
  /**
   * Is `agent` of `sessionId` still owed a report by a child other than `except` — the
   * children whose reports are already queued?
   */
  awaits(sessionId: string, except: ReadonlySet<string>): boolean
  /** Called with the delegator's session each time one of its children's reports settles. */
  subscribe(listener: (sessionId: string) => void): () => void
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
  /** Mini apps whose tools the answering turn carries (`WakeRequest.miniApp`). */
  miniApps?: string[]
  internal?: boolean
  source?: WakeSource
  bindings?: MessageBinding[]
  toolSurface?: ToolSurface
  executionContext?: RunExecutionContext
  to?: { agentId: string }
  command?: QueuedCommand
  /**
   * The words are the PERSON'S — typed into a busy session, or a prompt a client sent for them —
   * whatever `source` says. They are routed as a typed message is, by their own text, in the queue
   * exactly as when the session is idle.
   */
  person?: true
  /** Deliver together with the other queued wakes of this key (`WakeRequest.coalesce`). */
  coalesce?: string
  /** A delegated child's report (`WakeRequest.report`). */
  report?: DelegatedReport
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
    'extraAllowedTools' | 'requiredTools' | 'ccScopedHooks' | 'modelOverride' | 'effortOverride'
  >
}

export interface WakeOptions {
  waitForCompletion?: boolean
  continuation?: RunCompletion
}
