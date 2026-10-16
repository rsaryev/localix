import type { AgentSource } from '@localixai/agent/agents'
import { sessionSource } from './source-refs'
import type {
  ChildRuntimeStatus,
  EarlyDelegationOutcome,
  QueuedDelegation,
  TaskDelegationDetails,
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

/** What became of one started task, in the words the delegator acts on. */
export function describeStartedTask(
  early: Started,
  child: { label: string; title: string; sessionId: string; taskName?: string | null },
): TaskLine {
  const details = (status: ChildRuntimeStatus): TaskDelegationDetails => ({
    sessionId: child.sessionId,
    title: child.title,
    status,
    ...(child.taskName ? { taskName: child.taskName } : {}),
  })
  const sources = (status: ChildRuntimeStatus): AgentSource[] => [
    sessionSource({
      sessionId: child.sessionId,
      title: child.taskName ?? child.title,
      ...(status === 'failed' || status === 'stopped' ? { status: 'failed' as const } : {}),
    }),
  ]
  const line = (text: string, status: ChildRuntimeStatus, failed = false): TaskLine => ({
    line: `- ${child.label}: ${text}`,
    failed,
    details: details(status),
    sources: sources(status),
  })
  if (early && 'queued' in early) {
    return line(
      `queued for "${child.title}" (position ${early.queued}) — it starts on its own when a running sub-agent finishes.`,
      'idle',
    )
  }
  if (early && (early.status !== 'completed' || !early.hasReport)) {
    const status = early.status === 'stopped' ? 'stopped' : 'failed'
    return line(`${status} before completing "${child.title}".`, status, true)
  }
  if (early?.status === 'completed')
    return line(`completed "${child.title}" immediately. Review its report.`, 'completed')
  return line(`started "${child.title}"; its report will return to this session.`, 'running')
}
