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

/** The agent a task goes to as the registry resolves it, with the defaults its child run takes. */
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
  /** Where the delegating session sits in the tree, and which agent delegates. Read per call. */
  position: () => MaybePromise<DelegationPosition>
  /** Resolve an agent by id or handle for child work; null when it is not enabled here. */
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
  /** Copy this conversation, filtered, into a child started with `context: "conversation"`. */
  copyConversation: (childSessionId: string) => Promise<void>
}
