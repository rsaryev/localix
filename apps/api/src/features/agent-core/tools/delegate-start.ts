import { errorMessage } from '../../../lib/errors'
import { admitDelegation, DEFAULT_DELEGATION_BUDGET } from '../delegation-budget'
import { holdReport, type HeldReport } from '../delegation-awaits'
import { delegatesAt, delegationNote } from '../delegation-hierarchy'
import { ONE_SHOT_EXECUTION } from '../prompt/sections/team-contract'
import { reportBody } from './child-report'
import type { DelegateRequest } from './delegate'
import {
  agentTypeRefusal,
  GENERAL_PURPOSE_TYPE,
  prepareAgentChild,
  resolveDelegateTarget,
  type DelegateAgentPorts,
  type DelegateTarget,
} from './delegate-agent-type'
import { planFork } from './delegate-fork'
import {
  describeStartedTask,
  type TaskDelegationOptions,
  type TaskDelegationResult,
} from './task-delegation'
import type { DelegateAgent } from './task-delegation-contracts'

/**
 * How long `wait: true` holds the delegating call. Past it the child keeps working and its report
 * arrives as a message, exactly as if the call had not waited.
 */
export const DELEGATE_WAIT_MS = 10 * 60_000

/**
 * What the child is told before its task: who asked, what it can see, and where its reply goes.
 * Agents are named without `@`: an @handle in a reply invites that agent into the conversation, and
 * a model echoes the form it was shown (LOCALIX-30 wrote "underway with @backend").
 */
export function delegationFraming(delegator: string): string {
  return [
    `The agent ${delegator} delegated this task to you. You see only the task below, so take nothing else as given.`,
    `Do only this task. Your final reply is reported back to ${delegator}, so end with the result, its evidence and anything left open.`,
  ].join('\n')
}

const OUTCOME_WORD: Record<HeldReport['status'], string> = {
  completed: 'finished',
  failed: 'FAILED',
  stopped: 'was STOPPED before finishing',
}

/** What `startDelegation` needs to create one child and send it off. */
export interface ChildPlan {
  /** The agent seated in the child. */
  agent: DelegateAgent
  agentType: string
  maxTurns?: number
  /** Whether the call holds for the report. */
  wait: boolean
  notes: string[]
  /** What the child is created with, beyond the seat and the lineage. */
  create: Partial<Parameters<TaskDelegationOptions['createSession']>[1]>
  provenance: Record<string, unknown>
  /** Written after the child exists and before it runs. */
  afterCreate?: (childId: string) => Promise<void>
  /** The child's first message, given what a SubagentStart hook added. */
  task: (startContext: string | undefined) => string
}

/**
 * Start one delegated task: resolve who runs it, create the child, and run it. An `agent` that
 * names a catalog agent seats it, and the child runs as that agent (`delegate-agent-type.ts`); a
 * fork seats the delegator itself and carries its line (`delegate-fork.ts`).
 */
export async function startDelegation(
  toolCallId: string,
  request: DelegateRequest,
  opts: TaskDelegationOptions,
  signal?: AbortSignal,
  ports?: DelegateAgentPorts,
): Promise<TaskDelegationResult> {
  const title = request.title.trim()
  const task = request.task.trim()
  const refuse = (content: string): TaskDelegationResult => ({ content, isError: true })
  if (!title || !task) return refuse('delegate needs a title and a task.')
  const { depth, chain, self } = await opts.position()
  if (!self) return refuse('Only an agent can delegate.')
  if (!delegatesAt(depth))
    return refuse('A delegated task cannot be delegated again: do it yourself.')
  const admission = admitDelegation(DEFAULT_DELEGATION_BUDGET, {
    createdSinceHuman: (await opts.delegationsSinceHuman?.()) ?? 0,
  })
  if (!admission.ok) return refuse(admission.reason)
  try {
    const delegator = await opts.resolveAgent(self, { projectId: opts.projectId })
    if (!delegator) return refuse('Your own agent is unavailable, so it cannot delegate.')
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
          timeoutMs: DELEGATE_WAIT_MS,
          signal: signal ? AbortSignal.any([signal, giveUp.signal]) : giveUp.signal,
        })
      : null
    const name = agent.handle
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
    const extras = {
      ...(line.details ? { details: { tasks: [line.details] } } : {}),
      ...(line.sources ? { sources: line.sources } : {}),
    }
    // A start that already failed has nothing more to wait for, unless its report is in.
    if (line.failed) giveUp.abort()
    const report = held ? await held : null
    if (report) {
      // CC `maxTurns`: a child cut off at its turn limit hands back its output marked partial.
      const partial = report.partial === true && report.status === 'completed'
      return {
        content: [
          `- ${label}: ${partial ? 'reached its turn limit on' : OUTCOME_WORD[report.status]} "${title}".`,
          ...notes,
          '',
          reportBody(report.text, child.id, { partial }),
        ].join('\n'),
        ...extras,
        ...(report.status === 'completed' ? {} : { isError: true }),
      }
    }
    const content = [
      line.line,
      ...(held ? ['The wait ended before its report; the report will arrive as a message.'] : []),
      ...(request.wait && !planned.wait
        ? [`${name} always runs in the background; its report will arrive as a message.`]
        : []),
      ...notes,
    ].join('\n')
    return { content, ...extras, ...(line.failed ? { isError: true } : {}) }
  } catch (error) {
    return refuse(`Could not delegate "${title}": ${errorMessage(error)}`)
  }
}

/** A task for the delegator itself or for an agent of the catalog, from the task alone. */
async function planAgent(
  toolCallId: string,
  request: DelegateRequest,
  opts: TaskDelegationOptions,
  delegator: DelegateAgent,
  depth: number,
  ports?: DelegateAgentPorts,
): Promise<ChildPlan | { refusal: string }> {
  const target: DelegateTarget = request.agent
    ? await resolveDelegateTarget(request.agent, delegator, opts)
    : { agent: delegator }
  if ('refusal' in target) return target
  const { agent, type } = target
  const unlisted = agentTypeRefusal(
    ports,
    type ? [agent.handle, type.fullName, type.name] : [GENERAL_PURPOSE_TYPE],
  )
  if (unlisted) return { refusal: unlisted }
  // The call's own model, effort and worktree win over the agent's: routed against the chat's
  // provider, an alias resolving to a concrete id.
  const prepared = await prepareAgentChild(`agent ${agent.handle}`, type, ports, {
    toolCallId,
    ...(request.model ? { model: request.model } : {}),
    ...(request.effort ? { effort: request.effort } : {}),
    ...(request.isolation === 'worktree' ? { isolate: true } : {}),
  })
  return {
    agent,
    // Claude Code's `agent_type`: the agent's name, `general-purpose` for the delegator itself.
    agentType: type ? agent.handle : GENERAL_PURPOSE_TYPE,
    maxTurns: type?.maxTurns ?? agent.maxTurns,
    // Claude Code's `background: true`: the call never holds for its report.
    wait: request.wait && !type?.background,
    notes: prepared.notes,
    create: {
      ...prepared.route,
      ...(prepared.pinnedSkills ? { pinnedSkills: prepared.pinnedSkills } : {}),
    },
    provenance: prepared.provenance,
    task: (startContext) =>
      `${delegationFraming(delegator.handle)}\n\n${startContext ? `${startContext}\n\n` : ''}# Task\n${request.task.trim()}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
  }
}
