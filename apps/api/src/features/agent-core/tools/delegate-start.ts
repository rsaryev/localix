import { errorMessage } from '../../../lib/errors'
import { admitDelegation, DEFAULT_DELEGATION_BUDGET } from '../delegation-budget'
import { holdReport, type HeldReport } from '../delegation-awaits'
import { delegatesAt, delegationNote } from '../delegation-hierarchy'
import { resolveModelAlias } from '../model-alias'
import { ONE_SHOT_EXECUTION } from '../prompt/sections/team-contract'
import { reportBody } from './child-report'
import type { DelegateRequest } from './delegate'
import {
  preparePluginAgentChild,
  resolveDelegateTarget,
  type DelegatePluginPorts,
  type DelegateTarget,
} from './delegate-plugin-agent'
import {
  describeStartedTask,
  type TaskDelegationOptions,
  type TaskDelegationResult,
} from './task-delegation'

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
export function delegationFraming(delegator: string, context: DelegateRequest['context']): string {
  return [
    context === 'conversation'
      ? `The agent ${delegator} delegated this task to you. The conversation above is inherited context: its requests were already handled, other participants' roles and tasks are not yours, and earlier approvals do not carry over.`
      : `The agent ${delegator} delegated this task to you. You see only the task below, so take nothing else as given.`,
    `Do only this task. Your final reply is reported back to ${delegator}, so end with the result, its evidence and anything left open.`,
  ].join('\n')
}

const OUTCOME_WORD: Record<HeldReport['status'], string> = {
  completed: 'finished',
  failed: 'FAILED',
  stopped: 'was STOPPED before finishing',
}

/**
 * Start one delegated task: resolve the agent, create the child, give it context, and run it. An
 * `agent` that names a plugin's subagent type runs as that agent (`delegate-plugin-agent.ts`).
 */
export async function startDelegation(
  toolCallId: string,
  request: DelegateRequest,
  opts: TaskDelegationOptions,
  signal?: AbortSignal,
  plugins?: DelegatePluginPorts,
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
    const scope = { projectId: opts.projectId }
    const delegator = await opts.resolveAgent(self, scope)
    if (!delegator) return refuse('Your own agent is unavailable, so it cannot delegate.')
    const target: DelegateTarget = request.agent
      ? await resolveDelegateTarget(request.agent, delegator, opts, plugins)
      : { agent: delegator }
    if ('refusal' in target) return refuse(target.refusal)
    const { agent, plugin } = target
    // A host's pick of the child's model: an alias resolves to a concrete id, or to the parent's.
    const modelId = request.model ? resolveModelAlias(request.model, undefined) : undefined
    const typed =
      plugin && plugins
        ? await preparePluginAgentChild(plugin, plugins, { toolCallId, hostModel: !!modelId })
        : null
    // Claude Code's `background: true`: the call never holds for its report.
    const wait = request.wait && !plugin?.background
    const name = plugin?.fullName ?? agent.handle
    const maxTurns = plugin?.maxTurns ?? agent.maxTurns
    const notes = typed?.notes ?? []
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
        ...typed?.provenance,
      },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...typed?.route,
      ...(typed?.pinnedSkills ? { pinnedSkills: typed.pinnedSkills } : {}),
      ...(modelId ? { modelId } : {}),
    })
    // The copy precedes the run: the child's first model call must already see the conversation.
    if (request.context === 'conversation') await opts.copyConversation(child.id)
    const agentType = plugin?.fullName ?? agent.agentId
    opts.onSubagentStart?.(agentType, child.id)
    // Held before the start, so a child that ends inside the launch's settle window still
    // reports to this call rather than to a wake.
    const giveUp = new AbortController()
    const held = wait
      ? holdReport(child.id, {
          timeoutMs: DELEGATE_WAIT_MS,
          signal: signal ? AbortSignal.any([signal, giveUp.signal]) : giveUp.signal,
        })
      : null
    const label = `agent ${name} (${child.taskName ? `name: ${child.taskName}, ` : ''}id: ${child.id})`
    const early = await opts.startSubagentTask(
      opts.userId,
      child.id,
      `${delegationFraming(delegator.handle, request.context)}\n\n# Task\n${task}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
      {
        ...(maxTurns ? { maxTurns } : {}),
        agentType,
        label: `agent ${name}`,
        priority: 'normal',
      },
    )
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
      return {
        content: [
          `- ${label}: ${OUTCOME_WORD[report.status]} "${title}".`,
          ...notes,
          '',
          reportBody(report.text, child.id),
        ].join('\n'),
        ...extras,
        ...(report.status === 'completed' ? {} : { isError: true }),
      }
    }
    const content = [
      line.line,
      ...(held ? ['The wait ended before its report; the report will arrive as a message.'] : []),
      ...(request.wait && !wait
        ? [`${name} always runs in the background; its report will arrive as a message.`]
        : []),
      ...notes,
    ].join('\n')
    return { content, ...extras, ...(line.failed ? { isError: true } : {}) }
  } catch (error) {
    return refuse(`Could not delegate "${title}": ${errorMessage(error)}`)
  }
}
