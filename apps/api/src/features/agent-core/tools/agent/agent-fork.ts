import { ONE_SHOT_EXECUTION, PARENT_LINE } from '../../prompt/sections/subagent-contract'
import { delegationNote } from '../../delegation-hierarchy'
import { prepareAgentChild } from './agent-type'
import type { AgentLaunchPorts } from './agent-type'
import type { ChildPlan } from './agent-start'
import type { AgentRequest } from './agent-tool'
import type { TaskAgent, TaskDelegationOptions } from '../task-delegation-contracts'

/**
 * A FORK: the calling agent's own line, continued in a child session.
 *
 * `Agent` with `subagent_type: "fork"`, as Claude Code names it. The child is the agent that
 * called, on the route and effort it ran on, with the same system prompt and the same tools, and
 * it reads exactly the conversation that agent's own run was sent up to the call. Nothing about
 * it differs from the parent's request but the end, which is what lets the provider's prompt
 * cache read the parent's prefix instead of writing it again (`chat/runtime/fork`). Its one new
 * message is the directive below.
 *
 * Because it is that agent, the call cannot choose another: an `agent`, a `model` and an `effort`
 * given with a fork are ignored, as Claude Code ignores them. A fork cannot start subagents or
 * forks in its turn (`delegatesAt`): its `Agent` tool stays in the list, so the tools block is the
 * parent's, and answers with an error.
 */

/** The reserved agent name that asks for a fork. No catalog agent can take it. */
export const FORK_AGENT = 'fork'

export const isForkName = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().toLowerCase() === FORK_AGENT

/**
 * What the parent's tool calls of the step that forked answer inside the fork's copy of the line:
 * the call had not returned when the line was cut. It stands where the parent's own result would,
 * and is the same for the fork's own call and every sibling call of the response that had not
 * finished — a regular `Agent`, a `Bash` — so it says what is true of all of them: not returned,
 * and the result goes to the agent that made the call. It named a fork for every one of them
 * before, and a fork read a sibling's `Agent` call as another fork (LOCALIX-430).
 */
export const FORK_CALL_RESULT =
  'This call had not returned when you were forked: its result goes to the agent that made it, not to you.'

/** The one message a fork is given after the line it inherits, in the user's place. */
export function forkDirective(
  delegator: string,
  task: string,
  startContext?: string,
  worktree?: string,
): string {
  return [
    `You are a fork of the agent ${delegator}: everything above is your own line, up to the call that started you. You are not the agent that made it, and you do not report to the person: ${delegator} reads your final reply.`,
    `Do only the directive below, using your tools directly: do not start subagents or fork again. End with the result, its evidence and anything left open.`,
    PARENT_LINE,
    // The line it inherits was written in the main checkout, and the system prompt it is sent
    // names that folder: the one place a fork is told otherwise is this, the message it adds.
    ...(worktree
      ? [
          '',
          `You work in ${worktree}, a separate git worktree of the same repository: the paths above name the main checkout, so use the same files under ${worktree}.`,
        ]
      : []),
    ...(startContext ? ['', startContext] : []),
    '',
    `# Directive\n${task}`,
    '',
    ONE_SHOT_EXECUTION,
    delegationNote(1),
  ].join('\n')
}

/** The plan for a fork: the delegator itself, on its own route, carrying its line. */
export async function planFork(
  toolCallId: string,
  request: AgentRequest,
  opts: TaskDelegationOptions,
  delegator: TaskAgent,
  ports?: AgentLaunchPorts,
): Promise<ChildPlan | { refusal: string }> {
  if (!opts.fork)
    return { refusal: 'A fork is not available here: start the Agent without subagent_type.' }
  const { fork } = opts
  const capture = await fork.capture(toolCallId)
  // Only the folder is the call's to choose: where the fork works, not who it is.
  const prepared = await prepareAgentChild(`agent ${delegator.name}`, undefined, ports, {
    toolCallId,
    ...(request.isolation === 'worktree' ? { isolate: true } : {}),
  })
  return {
    agent: delegator,
    agentType: FORK_AGENT,
    maxTurns: delegator.maxTurns,
    wait: request.wait,
    notes: prepared.notes,
    ...(prepared.worktree ? { worktree: prepared.worktree } : {}),
    create: {
      providerConnectionId: capture.route.providerConnectionId,
      modelId: capture.route.modelId,
      ...(capture.route.reasoningEffort ? { reasoningEffort: capture.route.reasoningEffort } : {}),
    },
    provenance: {
      ...prepared.provenance,
      fork: { baseMessageId: capture.baseMessageId, snapshotMessageId: capture.snapshotMessageId },
    },
    afterCreate: (childId) => fork.persist(childId, capture),
    task: (startContext) =>
      forkDirective(
        delegator.name,
        request.task.trim(),
        startContext,
        prepared.provenance.workingDir,
      ),
  }
}
