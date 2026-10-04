import type { AgentsService } from '../../agents/service-contract'
import type { DelegatedRunSummary } from '../../agent-core/tools/agents'
import type { TaskDelegationOptions } from '../../agent-core/tools/task-delegation-contracts'
import type { RunProfile } from '../../agent-core/run-shape'
/**
 * Late binding for the chatService reference the AGENT tools need.
 *
 * chatService is constructed AFTER the agent runner (it wraps the runner), so the tools
 * resolve it lazily at call time through this module.
 *
 * Named for the whole surface rather than for one tool: the `agents` tool, session forks and
 * delegation recovery all read the same late-bound host. It was `delegate-service-binding.ts`
 * back when `delegate` was the only tool here and the only name for the act.
 */

import type { AgentRuntimeStatus, ReasoningEffort } from '../../../db/types'
import type { WakeRequest } from '../contracts'
import type { RunInvocation } from './execution-context'
import type { SessionProvenance } from '../session-provenance'
import type { SubagentMessageDelivery } from '../service/subagent-messages'
import type { SubagentCloseResult } from '../service/subagent-close'
import type { DelegationPriority } from '../../agent-core/delegation-lanes'

export interface AgentServiceBinding {
  /** A persisted identity in its exact scope, admitted for delegation — the fork API's lookup. */
  resolveAgentById?: (
    agentId: string,
    scope: { projectId?: string },
  ) => Promise<{ agentId: string; maxTurns?: number; pinnedSkills?: readonly string[] } | null>
  /** An agent named by id OR handle, admitted for delegation — what `agents delegate` names. */
  resolveDelegateAgent?: TaskDelegationOptions['resolveAgent']
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
       * (`runtime/subagent-mode.ts`); the delegate tool never names a mode itself.
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
  /** MAY be async — the host hits the DB / plugin catalog. See TaskDelegationOptions. */
  resolveSubagentType?: (
    subagentType: string,
    ctx: { projectId?: string; cwd?: string | null },
  ) =>
    | Promise<{
        agentId?: string
        prompt: string
        tools?: string[] | readonly string[]
        disallowedTools?: string[] | readonly string[]
        pinnedSkills?: string[] | readonly string[]
        preferredProvider?: string
        preferredModel?: string
        preferredEffort?: string
        maxTurns?: number
        memory?: 'user' | 'project' | 'local'
        color?: string
        isolation?: 'isolated'
        background?: boolean
        hooks?: unknown
      } | null>
    | {
        agentId?: string
        prompt: string
        tools?: string[] | readonly string[]
        disallowedTools?: string[] | readonly string[]
        pinnedSkills?: string[] | readonly string[]
        preferredProvider?: string
        preferredModel?: string
        preferredEffort?: string
        maxTurns?: number
        memory?: 'user' | 'project' | 'local'
        color?: string
        isolation?: 'isolated'
        background?: boolean
        hooks?: unknown
      }
    | null
  /** Final assistant text of a (completed) session — a child's report to its parent. */
  finalAssistantText?: (userId: string, sessionId: string) => Promise<string | null>
  /** Stop an owned child session. callerUserId is enforced by chatService. */
  stopSession?: (sessionId: string, callerUserId?: string) => void | Promise<void>
  /** A delegator's message to its child: joins a running run, or opens a new one (`agents message`). */
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
  /** The different agents a session's open children involve — the delegation ladder's count. */
  delegatedAgentsOf?: (userId: string, parentSessionId: string) => Promise<string[]>
  /** Close a delegated child for good (`agents close`) — see `service/subagent-close.ts`. */
  closeSubagent?: (userId: string, sessionId: string) => Promise<SubagentCloseResult>
  /** After a child's run ends: start the next one for delegator messages no run took. */
  flushChildMessages?: (userId: string, sessionId: string) => Promise<void>
  /** The children ONE session delegated (`service/delegated-runs.ts`). */
  listDelegatedRuns?: (
    userId: string,
    parentSessionId: string,
    opts?: { usage?: boolean },
  ) => Promise<DelegatedRunSummary[]>
}

let current: AgentServiceBinding | null = null

export function setAgentService(svc: AgentServiceBinding): void {
  current = svc
}

export function getAgentService(): AgentServiceBinding | null {
  return current
}
