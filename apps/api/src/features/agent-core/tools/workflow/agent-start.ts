import type { AgentRoute } from '../../agent-model-route'
import { holdReport } from '../../delegation-awaits'
import { delegationNote } from '../../delegation-hierarchy'
import type { LaneSpec } from '../../delegation-lanes'
import { ONE_SHOT_EXECUTION } from '../../prompt/sections/team-contract'
import {
  preparePluginAgentChild,
  resolveDelegateTarget,
  type DelegatePluginPorts,
  type DelegateTarget,
} from '../delegate-plugin-agent'
import type { TaskDelegationOptions } from '../task-delegation'
import type { WorkflowAgentOutcome, WorkflowAgentRequest } from './runner'
import type { AgentWorktree } from './worktree'

/**
 * ONE AGENT OF A WORKFLOW, as a child session of the chat that runs it.
 *
 * The same child `delegate` starts (`delegate-start.ts`) — created under the chat, listed with its
 * other children — with what a workflow needs on top. The call always waits for the report, for as
 * long as the agent runs, because the script's next step reads it. The per-turn delegation budget
 * does not apply: a workflow has its own limit (`MAX_AGENTS_PER_RUN`). It runs in its run's pool
 * of lanes, at the workflow's concurrency, not in the chat's three. And it takes the script's
 * options: a `model` and an `effort` of its own, and a git worktree for `isolation: 'worktree'`.
 */

/** How long one agent's report is waited for; past it the agent counts as failed (null). */
export const WORKFLOW_AGENT_WAIT_MS = 6 * 60 * 60_000

const TITLE_MAX = 120

export interface WorkflowAgentDeps {
  opts: TaskDelegationOptions
  /** Stop a child the run gave up on. */
  stop: (childId: string) => Promise<void>
  /** The run the agent belongs to: its id names worktrees, its lane is its pool. */
  run: { id: string; lane?: LaneSpec }
  /** The route for an agent's `model` and `effort`, with a note for what could not be applied. */
  route?: (request: {
    model?: string
    effort?: string
  }) => Promise<{ route: AgentRoute; notes: string[] }>
  /** A fresh worktree of the chat's repository, for `isolation: 'worktree'`. */
  isolate?: (name: string) => Promise<AgentWorktree>
  /** What a finished child spent, from the usage ledger. */
  spend?: (childId: string) => Promise<{ outputTokens: number; costUsd: number | null } | null>
  /** The run's plugin agent types: an `agentType` of `<plugin>:<name>` runs as one. */
  plugins?: DelegatePluginPorts
}

/** What the child is told before its task: its reply is data for a script, not a message. */
export function workflowAgentFraming(delegator: string, workflow: string): string {
  return [
    `The agent ${delegator} runs the workflow ${workflow}; you are one of its agents. You see only the task below, so take nothing else as given.`,
    'Your final reply is returned to the workflow script as data, not shown to a person: end with exactly the result the task asks for, without preamble.',
  ].join('\n')
}

export async function startWorkflowAgent(
  toolCallId: string,
  workflow: string,
  request: WorkflowAgentRequest,
  deps: WorkflowAgentDeps,
  signal: AbortSignal,
): Promise<WorkflowAgentOutcome | null> {
  if (signal.aborted) return null
  const { opts } = deps
  const { depth, chain, self } = await opts.position()
  if (!self) throw new Error('Only an agent can run a workflow')
  const scope = { projectId: opts.projectId }
  const delegator = await opts.resolveAgent(self, scope)
  if (!delegator) throw new Error('The agent running this workflow is unavailable')
  const target: DelegateTarget = request.agentType
    ? await resolveDelegateTarget(request.agentType, delegator, opts, deps.plugins)
    : { agent: delegator }
  if ('refusal' in target) throw new Error(`agentType: ${target.refusal}`)
  const { agent, plugin } = target
  // A plugin agent type brings its prompt, tools, model and skills; the call's own options win.
  const typed =
    plugin && deps.plugins
      ? await preparePluginAgentChild(
          plugin,
          request.isolation === 'worktree' ? withoutIsolation(deps.plugins) : deps.plugins,
          { toolCallId, hostModel: Boolean(request.model) },
        )
      : null
  const notes: string[] = [...(typed?.notes ?? [])]
  let route: AgentRoute = typed?.route ?? {}
  if ((request.model || request.effort) && deps.route) {
    const resolved = await deps.route({ model: request.model, effort: request.effort })
    route = resolved.route
    notes.push(...resolved.notes)
  }
  if (request.isolation === 'worktree' && !deps.isolate)
    throw new Error("isolation: 'worktree' is not available in this chat")
  const worktree =
    request.isolation === 'worktree'
      ? await deps.isolate!(`${deps.run.id}-${request.ordinal}`)
      : undefined
  const title = `${workflow} · ${request.label}`.slice(0, TITLE_MAX)
  // `notes` is the outcome's own list: the worktree's fate, decided in `finally`, joins it.
  try {
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
        ...(worktree ? { workingDir: worktree.workingDir } : {}),
        ...(worktree?.byHook ? { worktreeByHook: true as const } : {}),
      },
      ...route,
      ...(typed?.pinnedSkills ? { pinnedSkills: typed.pinnedSkills } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
    })
    const runAs = plugin
      ? { ...agent, handle: plugin.fullName, maxTurns: plugin.maxTurns ?? agent.maxTurns }
      : agent
    const text = await runChild(child.id, runAs, delegator.handle, workflow, request, deps, signal)
    const spent = await deps.spend?.(child.id).catch(() => null)
    return {
      text,
      ...(spent ? { tokens: spent.outputTokens } : {}),
      ...(spent?.costUsd ? { costUsd: spent.costUsd } : {}),
      notes,
    }
  } finally {
    if (worktree) {
      const { kept } = await worktree.finish().catch(() => ({ kept: true }))
      if (kept)
        notes.push(
          worktree.byHook
            ? `agent "${request.label}" worked in ${worktree.dir}, which the WorktreeCreate hook made; it is kept, remove it when the work is done`
            : `agent "${request.label}" left its changes in the worktree ${worktree.dir} (branch ${worktree.branch})`,
        )
    }
  }
}

/** Start the child's run in its lane and wait for its report: the text, or null. */
async function runChild(
  childId: string,
  agent: { agentId: string; handle: string; maxTurns?: number },
  delegator: string,
  workflow: string,
  request: WorkflowAgentRequest,
  deps: WorkflowAgentDeps,
  signal: AbortSignal,
): Promise<string | null> {
  const { opts } = deps
  const { depth } = await opts.position()
  // CC: a SubagentStart hook's `additionalContext` reaches the child before its first prompt.
  const startContext = await opts.onSubagentStart?.(agent.agentId, childId)
  // Held before the start, so a child that ends at once still reports to this call.
  const giveUp = new AbortController()
  const held = holdReport(childId, {
    timeoutMs: WORKFLOW_AGENT_WAIT_MS,
    signal: AbortSignal.any([signal, giveUp.signal]),
  })
  const onAbort = () => void deps.stop(childId).catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try {
    const early = await opts.startSubagentTask(
      opts.userId,
      childId,
      `${workflowAgentFraming(delegator, workflow)}\n\n${startContext ? `${startContext}\n\n` : ''}# Task\n${request.prompt}\n\n${ONE_SHOT_EXECUTION}\n${delegationNote(depth + 1)}`,
      {
        ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
        agentType: agent.agentId,
        label: `agent ${agent.handle}`,
        priority: 'normal',
        ...(deps.run.lane ? { lane: deps.run.lane } : {}),
      },
    )
    // A start that already ended without a report has nothing more to wait for.
    if (early && 'status' in early && early.status && !early.hasReport) giveUp.abort()
    const report = await held
    return report?.status === 'completed' ? (report.text ?? '') : null
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** The call isolates the agent itself: the type's own isolation must not make a second worktree. */
function withoutIsolation(ports: DelegatePluginPorts): DelegatePluginPorts {
  const { isolate: _ours, ...rest } = ports
  return rest
}
