import type { AgentRuntimeStatus } from '../../../db/types'
import type { DelegationPriority } from '../delegation-lanes'
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
}

/** The child waits for a lane (`delegation-lanes.ts`): it starts when one of the running ends. */
export interface QueuedDelegation {
  queued: number
}

/** The forking agent as the registry resolves it, with the defaults its fork's run inherits. */
export interface DelegateAgent {
  agentId: string
  handle: string
  maxTurns?: number
  pinnedSkills?: readonly string[]
}

type MaybePromise<T> = T | Promise<T>

export interface TaskDelegationOptions {
  userId: string
  parentSessionId: string
  projectId?: string
  /** Where the forking session sits in the tree, and which agent forks. Read per call. */
  position: () => MaybePromise<DelegationPosition>
  /** Resolve the forking agent itself; null when it is no longer enabled. */
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
        /** The delegating agent itself, continuing in a copy of the conversation (`fork`). */
        forked?: true
      }
      projectId?: string
      pinnedSkills?: string[]
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
    },
  ) => Promise<EarlyDelegationOutcome | QueuedDelegation | undefined>
  onSubagentStart?: (agentType: string, agentId: string) => void
  /** Copy this conversation, as of the calling turn, into a forked child (`agent-fork.ts`). */
  inheritConversation?: (childSessionId: string) => Promise<void>
}
