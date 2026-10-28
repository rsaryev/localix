import type { AgentPermissionMode } from '../../../contracts/agent-permission-mode'
import type { AgentRuntimeStatus, ReasoningEffort } from '../../../db/types'
import type { DelegationPriority, LaneSpec } from '../delegation-lanes'
import type { DelegationPosition } from '../delegation-hierarchy'

export type ChildRuntimeStatus = AgentRuntimeStatus

/**
 * What one child's entry in an `Agent` result says of it. It is the child's state at the moment
 * the call RETURNS, not at its launch:
 *
 *   running   — started in the background (or a wait that ended before the child did);
 *   queued    — waiting for one of its parent's lanes (`queuePosition` says its place);
 *   completed — a synchronous call that got its reply (also an early finish);
 *   failed    — it failed, in a synchronous call or inside the launch window;
 *   stopped   — it was stopped before it finished.
 *
 * The transcript card reads it to show the child without a second lookup.
 */
export type TaskDelegationStatus = ChildRuntimeStatus | 'queued'

/**
 * What one `Agent` call returns about its child besides the text, as Claude Code's result does:
 * how it ended, which agent ran, the model it resolved to, what it used, and the worktree of an
 * isolated one. `async_launched` is a child that runs on and reports later.
 */
export interface AgentCallResult {
  status: 'completed' | 'async_launched' | 'failed' | 'stopped' | 'queued'
  agentId: string
  agentType: string
  name?: string
  resolvedModel?: string
  usage?: { tokens: number; outputTokens: number; costUsd: number | null }
  worktreePath?: string
  worktreeBranch?: string
  /** What its tool calls amount to, once it has finished. */
  toolStats?: AgentToolStats
}

export interface AgentToolStats {
  readCount: number
  searchCount: number
  bashCount: number
  editFileCount: number
  linesAdded: number
  linesRemoved: number
  otherToolCount: number
}

export interface TaskDelegationDetails {
  sessionId: string
  title: string
  status: TaskDelegationStatus
  /** 1-based place in the parent's queue; set only while `status` is `queued`. */
  queuePosition?: number
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
export interface TaskAgent {
  agentId: string
  name: string
  maxTurns?: number
  pinnedSkills?: readonly string[]
}

/** One catalog agent's definition, as delegation needs it (`CatalogAgent` is one). */
export interface TaskAgentType {
  fullName: string
  name: string
  description: string
  pinnedSkills?: readonly string[]
  maxTurns?: number
  background?: boolean
  isolation?: 'isolated'
  /** Its exact tool list, when its file has one; empty when no entry named a tool here. */
  tools?: readonly string[]
  /** Where the definition comes from: `plugin` and built-in agents ignore the fields below. */
  source?: string
  /** The file's `permissionMode`, as written. */
  permissionMode?: string
}

/** Who a task goes to, as the catalog resolves it and Access admits it. */
export type DelegateResolution =
  /** Start this agent as the child: it runs on its own definition. */
  | { kind: 'agent'; agent: TaskAgent; type: TaskAgentType }
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
  resolveAgent: (reference: string, scope: { projectId?: string }) => MaybePromise<TaskAgent | null>
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
        /** The mode the agent's file asked for, when the person owns the file. */
        agentPermissionMode?: AgentPermissionMode
        /** A fork: the line it inherits, as the parent held it at the call (`fork-capture.ts`). */
        fork?: { baseMessageId: string | null; snapshotMessageId: string }
      }
      projectId?: string
      pinnedSkills?: string[]
      /** A route of its own (a workflow `agent()`'s `model` and `effort`); else the parent's. */
      providerConnectionId?: string | null
      modelId?: string
      reasoningEffort?: ReasoningEffort
    },
  ) => Promise<{ id: string; taskName?: string | null; agent?: { modelId: string } | null }>
  /** What one session has spent: the usage an `Agent` result reports for its child. */
  spend?: (
    sessionId: string,
  ) => Promise<{ tokens: number; outputTokens: number; costUsd: number | null }>
  /** What its tool calls amount to: the `toolStats` of an `Agent` result. */
  toolStats?: (sessionId: string) => Promise<AgentToolStats>
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
  /**
   * Lend the delegating run's own line to a fork (`agent-fork.ts`): `capture` freezes, at the
   * call, what the run was sent and where it stands; `persist` writes it for the child once its
   * session exists. Absent where the run cannot lend it, and a fork is then refused.
   */
  fork?: {
    capture: (toolCallId: string) => Promise<ForkCapture>
    persist: (childSessionId: string, capture: ForkCapture) => Promise<void>
  }
}

/** The route a fork runs on: its parent's, whatever the call or an agent file might name. */
export interface ForkRoute {
  providerConnectionId: string | null
  modelId: string
  reasoningEffort?: ReasoningEffort
}

/** What a fork is born with. `host` is the chat's own state, carried to `persist` untouched. */
export interface ForkCapture {
  /** The parent's last settled row before the call; the fork reads the parent's line up to it. */
  baseMessageId: string | null
  /** The fork's own copy of the row the call was made in, written by `persist`. */
  snapshotMessageId: string
  route: ForkRoute
  host?: unknown
}
