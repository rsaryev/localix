import type { AgentRuntimeStatus } from '../../../db/types'
import type { DelegationPriority } from '../delegation-lanes'
import type { DelegationPosition } from '../delegation-hierarchy'

export type ChildRuntimeStatus = AgentRuntimeStatus

/**
 * One piece of work handed to a one-shot child: WHO does it and everything they need to know.
 *
 * The brief is the whole assignment. A child reads nothing of the parent's conversation, so a
 * brief that says "do the thing we discussed" starts a run that cannot succeed; the tool asks
 * for the prompt to be self-contained and hands it over verbatim. Where the work came from — a
 * plan, a checklist, a board card — is the parent's knowledge, not the delegation's: core
 * carries the brief and never learns what produced it.
 */
export interface DelegationBrief {
  /**
   * Who does it: agent ids or handles (with or without `@`), resolved against the registry.
   * One agent works alone; several share ONE child session as a team, led by the highest
   * leadership priority (`delegation-hierarchy.ts`).
   */
  agents: string[]
  /** A short name for the child session and its work record. */
  title: string
  /** The self-contained assignment. */
  prompt: string
  /** How urgent — its order when children wait for a slot (`delegation-lanes.ts`). Required. */
  priority: DelegationPriority
}

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

/** A registry agent admitted for delegation, with the defaults its run inherits. */
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
  /** Where the delegating session sits in the tree, and who it may hand work to. Read per call. */
  position: () => MaybePromise<DelegationPosition>
  /** Agent ids this session's children already involve — what the ladder counts against. */
  engagedAgents?: () => MaybePromise<readonly string[]>
  /** Resolve one of `DelegationBrief.agents`; null when no enabled agent answers to it. */
  resolveAgent: (
    reference: string,
    scope: { projectId?: string },
  ) => MaybePromise<DelegateAgent | null>
  /** Add assignees to the parent chat without scheduling a second conversation run. */
  inviteAgents: (agentIds: readonly string[]) => Promise<void>
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
}
