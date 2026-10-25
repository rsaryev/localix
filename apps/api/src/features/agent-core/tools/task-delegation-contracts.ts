import type { AgentRuntimeStatus, ReasoningEffort } from '../../../db/types'
import type { DelegationPriority, LaneSpec } from '../delegation-lanes'
import type { DelegationPosition } from '../delegation-hierarchy'

export type ChildRuntimeStatus = AgentRuntimeStatus

export interface TaskDelegationDetails {
  sessionId: string
  title: string
  status: ChildRuntimeStatus
  taskName?: string
}

export interface EarlyDelegationOutcome {
  status: ChildRuntimeStatus | null
  hasReport: boolean
  /** The run stopped at its turn limit (CC `maxTurns`): its output is partial, not a failure. */
  partial?: boolean
}

/** The child waits for a lane (`delegation-lanes.ts`): it starts when one of the running ends. */
export interface QueuedDelegation {
  queued: number
}

/** The agent a task goes to as the registry resolves it, with the defaults its child run takes. */
export interface DelegateAgent {
  agentId: string
  handle: string
  maxTurns?: number
  pinnedSkills?: readonly string[]
}

/** One catalog agent's definition, as delegation needs it (`CatalogAgent` is one). */
export interface DelegateAgentType {
  fullName: string
  name: string
  description: string
  preferredModel?: string
  preferredEffort?: string
  /** `localix.model`: a `<provider>/<model>` route Claude Code has no place for. */
  localix?: { model?: string }
  pinnedSkills?: readonly string[]
  maxTurns?: number
  background?: boolean
  isolation?: 'isolated'
  /** Its exact tool list, when its file has one; empty when no entry named a tool here. */
  tools?: readonly string[]
}

/** Who a task goes to, as the catalog resolves it and Access admits it. */
export type DelegateResolution =
  /** Seat this agent in the child: it runs on its own definition. */
  | { kind: 'agent'; agent: DelegateAgent; type: DelegateAgentType }
  /** `general-purpose`: the delegating agent itself. */
  | { kind: 'self' }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'unavailable' }

type MaybePromise<T> = T | Promise<T>

export interface TaskDelegationOptions {
  userId: string
  parentSessionId: string
  projectId?: string
  /** Where the delegating session sits in the tree, and which agent delegates. Read per call. */
  position: () => MaybePromise<DelegationPosition>
  /** The agent a task goes to for a name a person or model wrote (`resolveDelegation`). */
  resolveTarget: (
    reference: string,
    scope: { projectId?: string },
  ) => MaybePromise<DelegateResolution>
  /** The delegating agent itself, by id; null when it is not enabled here. */
  resolveAgent: (
    reference: string,
    scope: { projectId?: string },
  ) => MaybePromise<DelegateAgent | null>
  /** Children created since the person last wrote (`delegation-budget.ts`). */
  delegationsSinceHuman?: () => MaybePromise<number>
  createSession: (
    userId: string,
    input: {
      agents: Array<{ agentId: string }>
      title: string
      parentSessionId: string
      sessionKind: 'subagent'
      sourceToolCallId: string
      provenance: {
        kind: 'task-delegation'
        parentSessionId: string
        toolCallId: string
        priority: DelegationPriority
        depth: number
        chain: string[]
        /** Where the child works instead of the chat's folder: a workflow agent's worktree. */
        workingDir?: string
        /** A WorktreeCreate hook made that worktree, wherever it put it. */
        worktreeByHook?: true
        /** The `agent_type` SubagentStart named (`general-purpose` for the delegator itself). */
        agentType?: string
      }
      projectId?: string
      pinnedSkills?: string[]
      /** A route of its own (a workflow `agent()`'s `model` and `effort`); else the parent's. */
      providerConnectionId?: string | null
      modelId?: string
      reasoningEffort?: ReasoningEffort
    },
  ) => Promise<{ id: string; taskName?: string | null }>
  startSubagentTask: (
    userId: string,
    sessionId: string,
    task: string,
    opts: {
      maxTurns?: number
      agentType: string
      label: string
      priority: DelegationPriority
      /** The pool the child runs in, when not the parent's own (a workflow run's). */
      lane?: LaneSpec
    },
  ) => Promise<EarlyDelegationOutcome | QueuedDelegation | undefined>
  /**
   * CC SubagentStart, awaited before the child's first prompt is written: what the hooks add to
   * the child's context (their `additionalContext`, already wrapped as a system reminder), or
   * nothing.
   */
  onSubagentStart?: (agentType: string, agentId: string) => Promise<string | undefined>
  /** Copy this conversation, filtered, into a child started with `context: "conversation"`. */
  copyConversation: (childSessionId: string) => Promise<void>
}
