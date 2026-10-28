import type { AgentSource } from '@localixai/agent/agents'
import { sessionSource } from './source-refs'
import type {
  EarlyDelegationOutcome,
  QueuedDelegation,
  TaskDelegationDetails,
  TaskDelegationStatus,
} from './task-delegation-contracts'

export type { TaskDelegationDetails, TaskDelegationOptions } from './task-delegation-contracts'

export interface TaskDelegationResult {
  content: string
  details?: { tasks: TaskDelegationDetails[] }
  sources?: AgentSource[]
  isError?: boolean
}

/** One task's line in the result, and what the result reports about it. */
export interface TaskLine {
  line: string
  failed: boolean
  details?: TaskDelegationDetails
  sources?: AgentSource[]
}

export type Started = EarlyDelegationOutcome | QueuedDelegation | undefined

type ChildIdentity = { sessionId: string; title: string; taskName?: string | null }

/** The entry an `Agent` result carries for one child, in the state the call leaves it in. */
export function childDetails(
  child: ChildIdentity,
  status: TaskDelegationStatus,
  queuePosition?: number,
): { details: TaskDelegationDetails; sources: AgentSource[] } {
  return {
    details: {
      sessionId: child.sessionId,
      title: child.title,
      status,
      ...(queuePosition ? { queuePosition } : {}),
      ...(child.taskName ? { taskName: child.taskName } : {}),
    },
    sources: [
      sessionSource({
        sessionId: child.sessionId,
        title: child.taskName ?? child.title,
        ...(status === 'failed' || status === 'stopped' ? { status: 'failed' as const } : {}),
      }),
    ],
  }
}

/** What became of one started task, in the words the delegator acts on. */
export function describeStartedTask(
  early: Started,
  child: ChildIdentity & { label: string },
): TaskLine {
  const line = (
    text: string,
    status: TaskDelegationStatus,
    failed = false,
    queuePosition?: number,
  ): TaskLine => ({
    line: `- ${child.label}: ${text}`,
    failed,
    ...childDetails(child, status, queuePosition),
  })
  if (early && 'queued' in early) {
    return line(
      `queued for "${child.title}" (position ${early.queued}) — it starts on its own when a running subagent finishes, and you will be notified with its reply.`,
      'queued',
      false,
      early.queued,
    )
  }
  // CC `maxTurns`: a child cut off at its turn limit returns partial output, not a failure.
  if (early?.partial && early.status === 'completed') {
    return line(
      `reached its turn limit on "${child.title}"; its output is partial. Review its report.`,
      'completed',
    )
  }
  if (early && (early.status !== 'completed' || !early.hasReport)) {
    const status = early.status === 'stopped' ? 'stopped' : 'failed'
    return line(`${status} before completing "${child.title}".`, status, true)
  }
  if (early?.status === 'completed')
    return line(`completed "${child.title}" immediately. Review its report.`, 'completed')
  return line(
    `started "${child.title}" in the background. You will be notified with its reply as a message: do not poll, sleep or guess its result; keep working or end your turn.`,
    'running',
  )
}
