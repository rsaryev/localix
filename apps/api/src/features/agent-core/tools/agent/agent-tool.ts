import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { builtinToolExposure, TOOL } from '../../tool-names'
import { DELEGATION_SLOT_CAP } from '../../delegation-budget'
import { isForkName, FORK_AGENT } from './agent-fork'
import type { TaskDelegationResult } from '../task-delegation'

/**
 * `Agent` — Claude Code's tool for starting a subagent, by its name and fields.
 *
 * The subagent is a fresh run of the calling agent itself (`general-purpose`, or no
 * `subagent_type`), of another agent of the catalog (`agent-type.ts`), or a fork (`"fork"`): the
 * caller's own line continued, with everything it has seen (`agent-fork.ts`). By default it runs in
 * the background and its reply arrives as a later message; `run_in_background: false` holds the
 * call until it reports (`agent-start.ts`). Talking to it afterwards is `SendMessage`, stopping it
 * `TaskStop`.
 *
 * The one field of Claude Code's it does not take is the choice of model and effort (`model`,
 * `effort`): the person sets each agent's in its settings, with whatever providers they connected,
 * and a fork runs on its parent's. Where the child works (`isolation`) is its agent file's. A call
 * written for Claude Code that names them still runs; they are dropped before the schema.
 */
export const AGENT_CONTEXTS = ['none', 'fork'] as const
export type AgentContext = (typeof AGENT_CONTEXTS)[number]

export interface AgentRequest {
  task: string
  title: string
  /** The name the call gave: SendMessage and TaskStop reach the subagent by it. */
  name?: string
  /** Handle or id of the agent to run the task; the calling agent itself when absent. Never set on a fork. */
  agent?: string
  /** `fork`: the child continues the caller's own line (`agent-fork.ts`). */
  context: AgentContext
  wait: boolean
  /** `worktree`: a host asks for a fresh git worktree of the chat's repository. */
  isolation?: 'worktree'
}

export interface AgentToolPort {
  start(
    toolCallId: string,
    request: AgentRequest,
    signal?: AbortSignal,
  ): Promise<TaskDelegationResult>
}

const inputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('A short (3-5 word) description of the task.'),
    prompt: z.string().trim().min(1).max(8000).describe('The task for the subagent to perform.'),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'An agent from the agent directory, "fork" to continue this conversation as you, or omit to run it yourself with a fresh context.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe('false: hold this call until the subagent replies. Default true.'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe(
        'A name for the subagent: SendMessage({to: name}) and TaskStop reach it by it while it runs.',
      ),
  })
  .strict()
type AgentToolInput = z.infer<typeof inputSchema>

/** Claude Code's Agent fields that choose what the person or the agent file chooses here. */
const NOT_THE_CALLS = ['model', 'effort', 'isolation', 'team_name', 'mode', 'cwd'] as const

/** The runtime's pre-validation hook: Claude Code's fields that are not the call's to choose go. */
export function prepareAgentArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const input = { ...(raw as Record<string, unknown>) }
  for (const key of NOT_THE_CALLS) delete input[key]
  return input
}

const START: CallClass = { effect: 'session' }

/** The agent a call starts, as a permission rule names it (`Agent(Explore)`, `Agent(fork)`). */
export function agentPermissionResources(input: unknown): string[] {
  const type = ((input ?? {}) as { subagent_type?: unknown }).subagent_type
  if (isForkName(type)) return [FORK_AGENT]
  return typeof type === 'string' && type.trim() ? [type.trim()] : []
}

/**
 * What a subagent cannot do, told to the agent that briefs it — said from the exposure that
 * withholds the tools, so the sentence changes with the catalog. A parent that did not know it
 * briefed three children to test `Agent` and `TaskStop`, and they came back blocked (LOCALIX-430).
 */
const SUBAGENT_LIMITS = (() => {
  const withheld = [TOOL.Agent, TOOL.TaskStop].filter(
    (name) => builtinToolExposure(name)?.subagent === 'never',
  )
  const callsBack = builtinToolExposure(TOOL.SendMessage)?.subagent === 'default'
  return [
    withheld.length
      ? `A subagent has no ${withheld.join(' or ')}: do not give it work that needs them.`
      : '',
    callsBack ? `It can ${TOOL.SendMessage} you.` : '',
  ]
    .filter(Boolean)
    .join(' ')
})()

export function createAgentTool(port: AgentToolPort) {
  return defineAgentTool<AgentToolInput>({
    name: TOOL.Agent,
    label: 'Agent',
    activeVerb: 'Starting a subagent',
    description: [
      'Start a subagent in a child session for a well-scoped task — a broad search, a review, long independent work — so its detail stays out of your context and only its final reply comes back.',
      'subagent_type picks an agent from the agent directory; omit it to run the task yourself with a fresh context; "fork" starts a copy of you that has seen this whole conversation, on your model and tools, for work that needs all you know.',
      'Except for a fork, the subagent sees only the prompt: make it self-contained — the goal, what you already know, and what to return.',
      'It runs in the background and you are notified with its reply as a later message: do not poll, sleep or guess its result meanwhile; keep working or end your turn. run_in_background:false holds this call until the reply (up to 10 minutes) — only when your next step needs it.',
      `Up to ${DELEGATION_SLOT_CAP} run at once; more wait their turn. To follow up, SendMessage it: it keeps everything it learned.`,
      SUBAGENT_LIMITS,
    ].join(' '),
    inputSchema,
    prepareArguments: prepareAgentArguments,
    mutates: true,
    // Calls of one step overlap, as Claude Code's do: the lanes admit or queue each one in the
    // moment it asks (`delegation-lanes.ts`), so no barrier is needed to hold the cap, and a fork
    // waits for its own call to be recorded, not for its siblings (`fork-live.ts`).
    executionMode: 'parallel',
    classify: () => START,
    permissionResources: agentPermissionResources,
    async execute(toolCallId, input, signal) {
      return port.start(toolCallId, startRequest(input), signal)
    },
  })
}

/**
 * The request a call becomes. A fork is the caller itself, so nothing that would choose another
 * agent or model rides on it; `general-purpose` is the caller too.
 */
function startRequest(input: AgentToolInput): AgentRequest {
  const base = {
    task: input.prompt,
    // The child is listed and addressed by its name when the call gives one, as in Claude Code.
    title: input.name ?? input.description,
    ...(input.name ? { name: input.name } : {}),
    wait: input.run_in_background === false,
  }
  const host = input as AgentToolInput & { isolation?: unknown }
  const isolation = host.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}
  if (isForkName(input.subagent_type)) return { ...base, context: 'fork', ...isolation }
  const type = input.subagent_type?.trim()
  return {
    ...base,
    ...(type && !isSelf(type) ? { agent: type } : {}),
    context: 'none',
    ...isolation,
  }
}

/** Claude Code's names for the calling agent itself. */
const isSelf = (type: string) => ['general-purpose', 'claude'].includes(type.toLowerCase())
