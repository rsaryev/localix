import { errorMessage } from '../../../lib/errors'
import { admitDelegation, DEFAULT_DELEGATION_BUDGET } from '../delegation-budget'
import { delegatesAt, delegationNote } from '../delegation-hierarchy'
import { ONE_SHOT_EXECUTION } from '../system-prompt-team-contract'
import type { ForkRequest } from './fork'
import {
  describeStartedTask,
  type TaskDelegationOptions,
  type TaskDelegationResult,
} from './task-delegation'

/**
 * What the forked copy is told before its task (Codex's fork framing, adapted): the conversation
 * above it is inherited context, not instructions to re-run, and its job is the one task below.
 */
export const FORK_FRAMING = [
  'You are a fork of yourself. The conversation above is inherited context, copied when you forked: earlier requests in it were already handled by your original, and earlier approvals do not carry over.',
  'Do only the task below in this session. Your final reply is reported back to the conversation you forked from, so end with the result, its evidence and anything left open.',
].join('\n')

/** Fork the delegating agent: create the child, copy the conversation into it, and start it. */
export async function forkSelf(
  toolCallId: string,
  request: ForkRequest,
  opts: TaskDelegationOptions,
): Promise<TaskDelegationResult> {
  const title = request.title.trim()
  const task = request.task.trim()
  const refuse = (content: string): TaskDelegationResult => ({ content, isError: true })
  if (!title || !task) return refuse('fork needs a title and a task.')
  const { depth, chain, self } = await opts.position()
  if (!self) return refuse('Only an agent can fork itself.')
  if (!delegatesAt(depth)) return refuse('A fork cannot fork again: do this task yourself.')
  if (!opts.inheritConversation) return refuse('This session cannot be forked.')
  const admission = admitDelegation(DEFAULT_DELEGATION_BUDGET, {
    createdSinceHuman: (await opts.delegationsSinceHuman?.()) ?? 0,
  })
  if (!admission.ok) return refuse(admission.reason)
  try {
    const agent = await opts.resolveAgent(self, { projectId: opts.projectId })
    if (!agent) return refuse('Your own agent is unavailable, so it cannot be forked.')
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
        forked: true,
      },
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
    })
    // The copy precedes the run: the fork's first model call must already see the conversation.
    await opts.inheritConversation(child.id)
    opts.onSubagentStart?.(agent.agentId, child.id)
    const label = `fork of @${agent.handle} (${child.taskName ? `name: ${child.taskName}, ` : ''}id: ${child.id})`
    const early = await opts.startSubagentTask(
      opts.userId,
      child.id,
      `${FORK_FRAMING}\n\n# Task\n${task}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
      {
        ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
        agentType: agent.agentId,
        label: `fork of ${agent.handle}`,
        priority: 'normal',
      },
    )
    const line = describeStartedTask(early, {
      label,
      title,
      sessionId: child.id,
      taskName: child.taskName,
    })
    return {
      content: line.line,
      ...(line.details ? { details: { tasks: [line.details] } } : {}),
      ...(line.sources ? { sources: line.sources } : {}),
      ...(line.failed ? { isError: true } : {}),
    }
  } catch (error) {
    return refuse(`Could not fork "${title}": ${errorMessage(error)}`)
  }
}
