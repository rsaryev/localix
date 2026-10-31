import { errorMessage } from '../../../../lib/errors'
import { admitDelegation } from '../../delegation-budget'
import { holdReport, type HeldReport } from '../../delegation-awaits'
import { delegatesAt, delegationNote } from '../../delegation-hierarchy'
import { ONE_SHOT_EXECUTION, PARENT_LINE } from '../../prompt/sections/subagent-contract'
import { reportBody } from '../child-report'
import type { AgentRequest } from './agent-tool'
import {
  agentTypeRefusal,
  GENERAL_PURPOSE_TYPE,
  prepareAgentChild,
  resolveAgentTarget,
  type AgentLaunchPorts,
  type AgentTarget,
} from './agent-type'
import { planFork } from './agent-fork'
import {
  childDetails,
  describeStartedTask,
  type TaskDelegationOptions,
  type TaskDelegationResult,
  type TaskLine,
} from '../task-delegation'
import type { AgentCallResult, TaskAgent } from '../task-delegation-contracts'

/**
 * How long `run_in_background: false` holds the `Agent` call. Past it the child keeps working and
 * its report arrives as a message, exactly as if the call had not waited.
 */
export const AGENT_WAIT_MS = 10 * 60_000

/**
 * What the child is told before its task: who asked, what it can see, and where its reply goes.
 * Agents are named without `@`: an @name in a reply invites that agent into the conversation, and
 * a model echoes the form it was shown (LOCALIX-30 wrote "underway with @backend").
 */
export function delegationFraming(delegator: string): string {
  return [
    `The agent ${delegator} started you as a subagent for the task below. You see only this task, so take nothing else as given.`,
    `Do only this task. Your final reply goes back to ${delegator}, so end with the result, its evidence and anything left open.`,
    PARENT_LINE,
  ].join('\n')
}

const OUTCOME_WORD: Record<HeldReport['status'], string> = {
  completed: 'finished',
  failed: 'FAILED',
  stopped: 'was STOPPED before finishing',
}

/** How a returned report is worded: the turn limit, a child waiting for the delegator, or how it ended. */
function outcomeOf(report: HeldReport, partial: boolean): string {
  if (partial) return 'reached its turn limit on'
  if (report.waiting && report.status === 'completed') return 'is waiting for your answer on'
  return OUTCOME_WORD[report.status]
}

/** What `launchAgent` needs to create one child and send it off. */
export interface ChildPlan {
  /** The agent used by the child. */
  agent: TaskAgent
  agentType: string
  maxTurns?: number
  /** Whether the call holds for the report. */
  wait: boolean
  notes: string[]
  /** Where an isolated child works (`worktreePath`, `worktreeBranch` of the result). */
  worktree?: { path: string; branch?: string }
  /** What the child is created with, beyond the agent and the lineage. */
  create: Partial<Parameters<TaskDelegationOptions['createSession']>[1]>
  provenance: Record<string, unknown>
  /** Written after the child exists and before it runs. */
  afterCreate?: (childId: string) => Promise<void>
  /** The child's first message, given what a SubagentStart hook added. */
  task: (startContext: string | undefined) => string
}

/**
 * Start one subagent: resolve who runs it, create the child, and run it. An `agent` that names a
 * catalog agent starts it, and the child runs as that agent (`agent-type.ts`); a fork starts the
 * caller itself and carries its line (`agent-fork.ts`).
 */
export async function launchAgent(
  toolCallId: string,
  request: AgentRequest,
  opts: TaskDelegationOptions,
  signal?: AbortSignal,
  ports?: AgentLaunchPorts,
): Promise<TaskDelegationResult> {
  const title = request.title.trim()
  const task = request.task.trim()
  const refuse = (content: string): TaskDelegationResult => ({ content, isError: true })
  if (!title || !task) return refuse('Agent needs a description and a prompt.')
  const { depth, chain, self } = await opts.position()
  if (!self) return refuse('Only an agent can start a subagent.')
  if (!delegatesAt(depth))
    return refuse('A subagent cannot start subagents of its own: do the work yourself.')
  const admission = admitDelegation((await opts.delegationsSinceHuman?.()) ?? 0)
  if (!admission.ok) return refuse(admission.reason)
  try {
    const delegator = await opts.resolveAgent(self, { projectId: opts.projectId })
    if (!delegator) return refuse('Your own agent is unavailable, so it cannot start a subagent.')
    // A fork is the delegator itself, so it counts as `general-purpose` for an allowlist.
    const forkRefusal =
      request.context === 'fork'
        ? agentTypeRefusal(ports, [GENERAL_PURPOSE_TYPE, 'fork'])
        : undefined
    if (forkRefusal) return refuse(forkRefusal)
    const planned =
      request.context === 'fork'
        ? await planFork(toolCallId, request, opts, delegator, ports)
        : await planAgent(toolCallId, request, opts, delegator, depth, ports)
    if ('refusal' in planned) return refuse(planned.refusal)
    const { agent, notes } = planned
    const child = await opts.createSession(opts.userId, {
      agents: [{ agentId: agent.agentId }],
      title,
      parentSessionId: opts.parentSessionId,
      sessionKind: 'subagent',
      sourceToolCallId: toolCallId,
      provenance: {
        kind: 'task-delegation',
        parentSessionId: opts.parentSessionId,
        toolCallId,
        priority: 'normal',
        depth: depth + 1,
        chain: [...chain, self],
        ...(request.name ? { name: request.name } : {}),
        agentType: planned.agentType,
        ...planned.provenance,
      },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...planned.create,
    })
    await planned.afterCreate?.(child.id)
    // CC: a SubagentStart hook's `additionalContext` reaches the child before its first prompt.
    const startContext = await opts.onSubagentStart?.(planned.agentType, child.id)
    // Held before the start, so a child that ends inside the launch's settle window still
    // reports to this call rather than to a wake.
    const giveUp = new AbortController()
    const held = planned.wait
      ? holdReport(child.id, {
          timeoutMs: AGENT_WAIT_MS,
          signal: signal ? AbortSignal.any([signal, giveUp.signal]) : giveUp.signal,
        })
      : null
    const name = agent.name
    const label = `agent ${name} (${child.taskName ? `name: ${child.taskName}, ` : ''}id: ${child.id})`
    const early = await opts.startSubagentTask(opts.userId, child.id, planned.task(startContext), {
      ...(planned.maxTurns ? { maxTurns: planned.maxTurns } : {}),
      agentType: planned.agentType,
      label: `agent ${name}`,
      priority: 'normal',
    })
    const line = describeStartedTask(early, {
      label,
      title,
      sessionId: child.id,
      taskName: child.taskName,
    })
    const identity = { sessionId: child.id, title, taskName: child.taskName }
    // Claude Code's result record: agent id and type, resolved model, usage, worktree.
    const resultOf = async (status: AgentCallResult['status']): Promise<AgentCallResult> => {
      const finished = status !== 'async_launched' && status !== 'queued'
      const usage = finished ? await spent(child.id) : undefined
      const toolStats = finished
        ? ((await opts.toolStats?.(child.id).catch(() => null)) ?? undefined)
        : undefined
      return {
        status,
        agentId: child.id,
        agentType: planned.agentType,
        ...(request.name ? { name: request.name } : {}),
        ...(child.agent?.modelId ? { resolvedModel: child.agent.modelId } : {}),
        ...(usage ? { usage } : {}),
        ...(toolStats ? { toolStats } : {}),
        ...(planned.worktree
          ? {
              worktreePath: planned.worktree.path,
              ...(planned.worktree.branch ? { worktreeBranch: planned.worktree.branch } : {}),
            }
          : {}),
      }
    }
    const spent = async (sessionId: string) =>
      (await opts.spend?.(sessionId).catch(() => null)) ?? undefined
    const extrasOf = (shown: Pick<TaskLine, 'details' | 'sources'>, agent: AgentCallResult) => ({
      ...(shown.details ? { details: { tasks: [shown.details], agent } } : {}),
      ...(shown.sources ? { sources: shown.sources } : {}),
    })
    const launched: AgentCallResult['status'] = line.failed
      ? 'failed'
      : line.details?.status === 'queued'
        ? 'queued'
        : 'async_launched'
    const extras = extrasOf(line, await resultOf(launched))
    // A start that already failed has nothing more to wait for, unless its report is in.
    if (line.failed) giveUp.abort()
    const report = held ? await held : null
    if (report) {
      // CC `maxTurns`: a child cut off at its turn limit hands back its output marked partial.
      const partial = report.partial === true && report.status === 'completed'
      // The card shows the child as the call leaves it, not as it was when it launched.
      const settled = extrasOf(childDetails(identity, report.status), await resultOf(report.status))
      return {
        content: [
          `- ${label}: ${outcomeOf(report, partial)} "${title}".`,
          ...notes,
          '',
          reportBody(report.text, child.id, { partial }),
        ].join('\n'),
        ...settled,
        ...(report.status === 'completed' ? {} : { isError: true }),
      }
    }
    const content = [
      line.line,
      ...(held
        ? ['The wait ended before its reply; you will be notified with it as a message.']
        : []),
      ...(request.wait && !planned.wait
        ? [
            `${name} always runs in the background; you will be notified with its reply as a message.`,
          ]
        : []),
      ...notes,
    ].join('\n')
    return { content, ...extras, ...(line.failed ? { isError: true } : {}) }
  } catch (error) {
    return refuse(`Could not start "${title}": ${errorMessage(error)}`)
  }
}

/** A task for the delegator itself or for an agent of the catalog, from the task alone. */
async function planAgent(
  toolCallId: string,
  request: AgentRequest,
  opts: TaskDelegationOptions,
  delegator: TaskAgent,
  depth: number,
  ports?: AgentLaunchPorts,
): Promise<ChildPlan | { refusal: string }> {
  const target: AgentTarget = request.agent
    ? await resolveAgentTarget(request.agent, delegator, opts)
    : { agent: delegator }
  if ('refusal' in target) return target
  const { agent, type } = target
  const unlisted = agentTypeRefusal(
    ports,
    type ? [agent.name, type.fullName, type.name] : [GENERAL_PURPOSE_TYPE],
  )
  if (unlisted) return { refusal: unlisted }
  // The model and effort are the person's choice for this agent, else the session's.
  const prepared = await prepareAgentChild(`agent ${agent.name}`, type, ports, {
    toolCallId,
    agentId: agent.agentId,
    ...(request.isolation === 'worktree' ? { isolate: true } : {}),
  })
  return {
    agent,
    // Claude Code's `agent_type`: the agent's name, `general-purpose` for the delegator itself.
    agentType: type ? agent.name : GENERAL_PURPOSE_TYPE,
    maxTurns: type?.maxTurns ?? agent.maxTurns,
    // Claude Code's `background: true`: the call never holds for its report.
    wait: request.wait && !type?.background,
    notes: prepared.notes,
    ...(prepared.worktree ? { worktree: prepared.worktree } : {}),
    create: {
      ...prepared.route,
      ...(prepared.pinnedSkills ? { pinnedSkills: prepared.pinnedSkills } : {}),
    },
    provenance: prepared.provenance,
    task: (startContext) =>
      `${delegationFraming(delegator.name)}\n\n${startContext ? `${startContext}\n\n` : ''}# Task\n${request.task.trim()}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
  }
}
