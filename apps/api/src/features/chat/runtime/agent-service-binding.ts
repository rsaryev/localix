import type { SessionToolStats } from '../service/delegated-runs'
import type { AgentsService } from '../../agents/service-contract'
import type { ChildRunSummary } from '../../agent-core/tools/agent/agent-control'
import type { TaskDelegationOptions } from '../../agent-core/tools/task-delegation-contracts'
import type { RunProfile } from '../../agent-core/run-shape'
/**
 * Late binding for the chatService reference the AGENT tools need.
 *
 * chatService is constructed AFTER the agent runner (it wraps the runner), so the tools
 * resolve it lazily at call time through this module.
 *
 * Named for the whole surface rather than for one tool: the `fork` tool, skill forks and
 * delegation recovery all read the same late-bound host. It was `delegate-service-binding.ts`
 * back when `Agent` was the only tool here and the only name for the act.
 */

import type { AgentRuntimeStatus, ReasoningEffort } from '../../../db/types'
import type { WakeRequest } from '../contracts'
import type { RunInvocation } from './execution-context'
import type { SessionProvenance } from '../session-provenance'
import type { SubagentMessageDelivery } from '../service/subagent-messages'
import type { SubagentCloseResult } from '../service/subagent-close'
import type { DelegationPriority } from '../../agent-core/delegation-lanes'

export interface AgentServiceBinding {
  /** The delegating agent, by id, admitted for child work. */
  resolveDelegateAgent?: TaskDelegationOptions['resolveAgent']
  /** The agent a task goes to for the name `Agent`, a workflow or a skill's fork wrote. */
  resolveDelegation?: TaskDelegationOptions['resolveTarget']
  /**
   * Create a child session. Returns its id plus `taskName` — the child's addressable canonical
   * name (`/root/audit_repo`), assigned by the store at insert (see
   * `agent-core/agent-task-name.ts`). Reported back so the spawning agent can address the agent it
   * just started instead of carrying an opaque `LOCALIX-<seq>` around; null only for a session that
   * predates the column.
   */
  createSession: (
    userId: string,
    input: {
      agents?: Array<{ agentId: string }>
      title: string
      parentSessionId: string
      sessionKind: 'subagent' | 'job'
      sourceToolCallId: string
      provenance: SessionProvenance
      providerConnectionId?: string | null
      modelId?: string
      reasoningEffort?: ReasoningEffort
      projectId?: string
      pinnedSkills?: string[]
      /**
       * Permission mode for the child. A child session is created fresh and would
       * otherwise default to `auto`, so an `ask`-mode parent silently spawned a child
       * that mutates without confirmation. The host fills this in from the parent's mode
       * (`runtime/subagent-mode.ts`); the `Agent` tool never names a mode itself.
       */
    },
  ) => Promise<{ id: string; taskName: string | null }>
  runJobTask: (
    userId: string,
    sessionId: string,
    task: string,
    opts: {
      invocation: Exclude<RunInvocation, { kind: 'root' }>
      extraDisabledTools?: string[]
      /** A caller-resolved profile (tools + identity) for this run instead of the session's. */
      profileOverride?: RunProfile
      /** Block until the run fully completes (synchronous delegation). */
      wait?: boolean
      /** CC `maxTurns` — cap this child run's turn count (undefined = host default). */
      maxTurns?: number
    },
  ) => Promise<unknown>
  /** One admitted snapshot supplies both native behavior and execution policy. */
  resolveRunAgent?: AgentsService['resolveRunAgent']
  /** Final assistant text of a (completed) session — a child's report to its parent. */
  finalAssistantText?: (userId: string, sessionId: string) => Promise<string | null>
  /** Stop an owned child session. callerUserId is enforced by chatService. */
  stopSession?: (sessionId: string, callerUserId?: string) => void | Promise<void>
  /**
   * The agent stopped this child: record that no report of it is owed, so the recovery sweep does
   * not send one for a child that never got to run (`service/delegation-stop.ts`).
   */
  recordChildStopped?: (userId: string, sessionId: string) => Promise<void>
  /** A parent's message to its child: joins a running run, or opens a new one (`Agent`). */
  messageSubagent?: (
    userId: string,
    sessionId: string,
    content: string,
    priority?: DelegationPriority,
    interrupt?: boolean,
  ) => Promise<SubagentMessageDelivery>
  /**
   * Push an internal message into the PARENT chat session and run it — how a
   * background (non-blocking) delegate child delivers its result when it finishes.
   * Queued behind an in-flight run by the wake queue; no-op for non-chat sessions.
   */
  wakeSession?: (request: WakeRequest) => Promise<void>
  /** Runtime status of a (finished) child session — lets delegate distinguish a failed/stopped child from a real result. */
  childRuntimeStatus?: (sessionId: string) => Promise<AgentRuntimeStatus | null>
  /**
   * Children created in this conversation since the person last wrote — the delegation budget
   * (`delegation-budget.ts`). Concurrency is not counted here: the lanes hold it
   * (`delegation-lanes.ts`).
   */
  countDelegationsSinceHuman?: (userId: string, rootSessionId: string) => Promise<number>
  /** Close a child for good (`Agent` close) — see `service/subagent-close.ts`. */
  closeSubagent?: (userId: string, sessionId: string) => Promise<SubagentCloseResult>
  /** After a child's run ends: start the next one for delegator messages no run took. */
  flushChildMessages?: (userId: string, sessionId: string) => Promise<void>
  /**
   * What one session has spent, the canonical total its composer shows (`readSessionSpend` in
   * `service/delegated-runs.ts`): a workflow's `budget` counts its agents' output tokens by it.
   */
  sessionSpend?: (
    userId: string,
    sessionId: string,
  ) => Promise<{ tokens: number; outputTokens: number; costUsd: number | null }>
  /** What one session's tool calls amount to (`toolStats` of an Agent result). */
  sessionToolStats?: (userId: string, sessionId: string) => Promise<SessionToolStats>
  /** The children ONE session delegated (`service/delegated-runs.ts`). */
  listDelegatedRuns?: (
    userId: string,
    parentSessionId: string,
    opts?: { usage?: boolean },
  ) => Promise<ChildRunSummary[]>
}

let current: AgentServiceBinding | null = null
let bound: (() => void) | undefined
let ready = new Promise<void>((resolve) => (bound = resolve))

export function setAgentService(svc: AgentServiceBinding): void {
  current = svc
  bound?.()
}

/**
 * The binding, once boot has made it. A run a wake or a trigger starts while the server is still
 * booting would otherwise find no agent service and fail as "Agent is unavailable"; it waits for
 * the binding instead, up to `timeoutMs`, and only then is the service truly missing.
 */
export async function awaitAgentService(timeoutMs = 30_000): Promise<AgentServiceBinding | null> {
  if (current) return current
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([ready, new Promise<void>((done) => (timer = setTimeout(done, timeoutMs)))])
  clearTimeout(timer)
  return current
}

export function getAgentService(): AgentServiceBinding | null {
  return current
}
