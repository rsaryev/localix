import type { AgentSource } from '@localixai/agent/agents'
import { errorMessage } from '../../../lib/errors'
import { admitDelegation, DEFAULT_DELEGATION_BUDGET } from '../delegation-budget'
import { admitAssignees, delegationNote, type DelegationPosition } from '../delegation-hierarchy'
import { sessionSource } from './source-refs'
import { ONE_SHOT_EXECUTION } from '../system-prompt-team-contract'
import type {
  ChildRuntimeStatus,
  DelegateAgent,
  DelegationBrief,
  EarlyDelegationOutcome,
  QueuedDelegation,
  TaskDelegationDetails,
  TaskDelegationOptions,
} from './task-delegation-contracts'

export type {
  ChildRuntimeStatus,
  DelegationBrief,
  TaskDelegationDetails,
  TaskDelegationOptions,
} from './task-delegation-contracts'

export interface TaskDelegationResult {
  content: string
  details?: { tasks: TaskDelegationDetails[] }
  sources?: AgentSource[]
  isError?: boolean
}

/**
 * How many tasks one `delegate` call may carry. Concurrency is the lanes' job (3 run, the rest
 * wait), so this bounds only what one call can put in motion — a model that writes ten briefs in
 * one step has usually not thought about any of them.
 */
export const MAX_TASKS_PER_DELEGATION = 6

/** One task's line in the result, and what the result reports about it. */
interface TaskLine {
  line: string
  failed: boolean
  details?: TaskDelegationDetails
  sources?: AgentSource[]
}

type Started = EarlyDelegationOutcome | QueuedDelegation | undefined

/**
 * Hand one or more briefs to children in ONE call: each admitted against the delegation budget,
 * its agent resolved, its child session created, its run started — now, or when one of the
 * parent's lanes frees (`delegation-lanes.ts`) — and the outcome of every task reported in one
 * result.
 *
 * WHY A BATCH. A lead that splits work into three independent tasks used to spend a model turn per
 * delegation — three requests, three times the conversation re-read — to say what it could have
 * said once. Now it says it once.
 *
 * ORDER, and why it is two phases. Children are created in the order given — the budget counts
 * each one as it is created, and the lanes are asked in that order, so ties in priority keep it.
 * But each started child is watched through a short settle window, and waiting for each window
 * in turn made three tasks cost three windows; so the windows are awaited TOGETHER at the end.
 * A task that fails does not stop the rest: each line says what became of its own task.
 */
export async function delegateTasks(
  toolCallId: string,
  briefs: readonly DelegationBrief[],
  opts: TaskDelegationOptions,
): Promise<TaskDelegationResult> {
  if (briefs.length === 0 || briefs.length > MAX_TASKS_PER_DELEGATION) {
    return {
      content: `delegate takes 1–${MAX_TASKS_PER_DELEGATION} tasks; got ${briefs.length}.`,
      isError: true,
    }
  }
  // Read once and counted forward: the children this call creates, and the agents they involve,
  // are this call's own.
  const counts: CallCounts = {
    position: await opts.position(),
    created: (await opts.delegationsSinceHuman?.()) ?? 0,
    engaged: new Set((await opts.engagedAgents?.()) ?? []),
  }
  const pending: Array<Promise<TaskLine>> = []
  for (const brief of briefs) {
    const launched = await launchOne(toolCallId, brief, opts, counts)
    if (launched.created) counts.created += 1
    pending.push(launched.outcome)
  }
  const lines = await Promise.all(pending)

  const failed = lines.filter((line) => line.failed).length
  const header =
    briefs.length === 1
      ? ''
      : `${briefs.length - failed} of ${briefs.length} tasks delegated. Continue independent work; each report returns to this session on its own.\n`
  return {
    content: header + lines.map((line) => line.line).join('\n'),
    details: { tasks: lines.flatMap((line) => (line.details ? [line.details] : [])) },
    sources: lines.flatMap((line) => line.sources ?? []),
    ...(failed === lines.length ? { isError: true } : {}),
  }
}

interface CallCounts {
  /** Where the delegating session sits, read once for the whole call. */
  position: DelegationPosition
  /** Children created in the tree since the person last wrote, this call's included. */
  created: number
  /** Agents this session's children involve, this call's included. */
  engaged: Set<string>
}

/**
 * Every named agent, resolved — or the first one that answers to nothing. A name repeated in one
 * task is one member, not two.
 */
async function resolveTeam(
  references: readonly string[],
  opts: TaskDelegationOptions,
): Promise<{ team: DelegateAgent[] } | { missing: string }> {
  const team: DelegateAgent[] = []
  for (const reference of references) {
    const agent = await opts.resolveAgent(reference, { projectId: opts.projectId })
    if (!agent) return { missing: reference }
    if (!team.some((member) => member.agentId === agent.agentId)) team.push(agent)
  }
  return { team }
}

/** Admit, create and start ONE child; the returned promise settles with its line. */
async function launchOne(
  toolCallId: string,
  brief: DelegationBrief,
  opts: TaskDelegationOptions,
  counts: CallCounts,
): Promise<{ created: boolean; outcome: Promise<TaskLine> }> {
  const title = brief.title.trim()
  const prompt = brief.prompt.trim()
  const refuse = (line: string) => ({
    created: false,
    outcome: Promise.resolve({ line, failed: true }),
  })
  if (!title || !prompt) return refuse('- A task needs a title and a self-contained prompt.')

  const admission = admitDelegation(DEFAULT_DELEGATION_BUDGET, {
    createdSinceHuman: counts.created,
  })
  if (!admission.ok) return refuse(`- "${title}": ${admission.reason}`)
  try {
    const resolved = await resolveTeam(brief.agents, opts)
    if ('missing' in resolved)
      return refuse(`- "${title}": no enabled agent answers to "${resolved.missing}".`)
    const { team } = resolved
    // Membership is validated by the host invitation, including roster locks and chat admission.
    const allowed = admitAssignees({ ...counts.position, group: null }, team, counts.engaged)
    if (!allowed.ok) return refuse(`- "${title}": ${allowed.reason}`)
    await opts.inviteAgents(team.map((member) => member.agentId))
    for (const member of team) counts.engaged.add(member.agentId)

    // The child's place in the tree: one level down, with this session's agent added to the
    // agents it may never hand work back to.
    const { depth, chain, self } = counts.position
    const child = await opts.createSession(opts.userId, {
      agents: team.map((member) => ({ agentId: member.agentId })),
      title,
      parentSessionId: opts.parentSessionId,
      sessionKind: 'subagent',
      sourceToolCallId: toolCallId,
      provenance: {
        kind: 'task-delegation',
        parentSessionId: opts.parentSessionId,
        toolCallId,
        priority: brief.priority,
        depth: depth + 1,
        chain: self ? [...chain, self] : [...chain],
      },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
    })
    for (const member of team) opts.onSubagentStart?.(member.agentId, child.id)
    const handles = team.map((member) => `@${member.handle}`).join(' + ')
    const label = `${handles} (${child.taskName ? `name: ${child.taskName}, ` : ''}id: ${child.id})`
    // A team shares the task: one turn cap (the tightest) and one record, named after all of it.
    const maxTurns = Math.min(...team.map((member) => member.maxTurns ?? Infinity))
    const started = opts.startSubagentTask(
      opts.userId,
      child.id,
      `${prompt}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
      {
        ...(Number.isFinite(maxTurns) ? { maxTurns } : {}),
        agentType: team[0]!.agentId,
        label: team.map((member) => member.handle).join(' + '),
        priority: brief.priority,
      },
    )
    return {
      created: true,
      outcome: started
        .then((early) =>
          describe(early, { label, title, sessionId: child.id, taskName: child.taskName }),
        )
        .catch((error: unknown) => ({
          line: `- "${title}": ${errorMessage(error)}`,
          failed: true,
        })),
    }
  } catch (error) {
    return refuse(`- Could not start "${title}": ${errorMessage(error)}`)
  }
}

/** What became of one started task, in the words the delegator acts on. */
function describe(
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
