import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'
import { asksForFork, FORK_AGENT } from './delegate-fork'
import type { TaskDelegationResult } from './task-delegation'
import {
  closeRun,
  eachRun,
  listDelegations,
  messageRun,
  stopRun,
  type DelegateControlPorts,
} from './delegate-control'

/**
 * `delegate` — hand one task to an agent in a child session, and keep a line to each child.
 *
 * The child is a fresh run of the delegating agent itself (`general-purpose`), or of another agent of
 * the catalog (`agent`, `delegate-agent-type.ts`). It starts from the task alone, or it is a fork
 * (`context: "fork"`, or `agent: "fork"` as Claude Code writes it): the delegating agent's own line
 * continued, with everything it has seen (`delegate-fork.ts`). By default the call returns at once
 * and the child's report arrives as a later message; `wait: true` holds the call until the child
 * reports (`delegate-start.ts`).
 *
 *   (no action)  start: `task` + `title`, optionally `agent`, `context`, `wait`
 *   message      amend a child — joins its running step, or runs a finished one again
 *   stop         end the current run of one or more children (they can be messaged later)
 *   close        end one or more children for good — nothing wakes them after
 *   list         this session's children: status, queue place, spend
 */
export const DELEGATE_CONTEXTS = ['none', 'fork'] as const
export type DelegateContext = (typeof DELEGATE_CONTEXTS)[number]

export interface DelegateRequest {
  task: string
  title: string
  /** Handle or id of the agent to run the task; the delegating agent itself when absent. Never set on a fork. */
  agent?: string
  /** `fork`: the child continues the delegator's own line (`delegate-fork.ts`). */
  context: DelegateContext
  wait: boolean
  /**
   * The child's model, an alias (`haiku`, `sonnet`, `opus`, `inherit`) or an id: the caller's, as
   * Claude Code's Agent tool takes it, or a host's pick (a Claude Code mod's `agent.spawn`), which
   * wins. Absent, the child runs on the parent's or its agent's. Never set on a fork.
   */
  model?: string
  /** The child's reasoning effort for this call (Claude Code's Agent `effort`). Never set on a fork. */
  effort?: string
  /** `worktree`: the child works in a fresh git worktree of the chat's repository. */
  isolation?: 'worktree'
}

export interface DelegateToolPort extends DelegateControlPorts {
  delegate(
    toolCallId: string,
    request: DelegateRequest,
    signal?: AbortSignal,
  ): Promise<TaskDelegationResult>
}

const DELEGATE_ACTIONS = ['message', 'stop', 'close', 'list'] as const
type DelegateAction = (typeof DELEGATE_ACTIONS)[number]

const runRef = z.string().trim().min(1)

const inputSchema = z
  .object({
    action: z.enum(DELEGATE_ACTIONS).optional().describe('Omit to start a task.'),
    task: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .optional()
      .describe('Start: the goal and when it is done.'),
    title: z.string().trim().min(1).max(120).optional().describe('Start: short name.'),
    agent: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('Start: an agent from the directory, by name; omit to run it yourself.'),
    context: z
      .enum(DELEGATE_CONTEXTS)
      .optional()
      .describe(
        'Start: fork to continue this conversation as you; none (default) sees only the task.',
      ),
    wait: z.boolean().optional().describe('Start: hold this call until the report.'),
    model: z.string().trim().min(1).max(120).optional().describe('Start: child model alias or id.'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('Start: effort.'),
    isolation: z.enum(['worktree']).optional().describe('Start: own git worktree.'),
    run: z
      .union([runRef, z.array(runRef).min(1).max(24)])
      .optional()
      .describe('Child session id or task name; stop/close accept a list.'),
    message: z.string().trim().min(1).max(8000).optional().describe('message: what changes.'),
    interrupt: z
      .boolean()
      .optional()
      .describe('message: stop its current run and restart with this message.'),
  })
  .strict()
type DelegateToolInput = z.infer<typeof inputSchema>

/**
 * One `delegate` call's class. Every child is a session this conversation owns, so the writes are
 * `session`. `stop` ends a run in flight and `close` ends a child for good; neither can be taken
 * back, so both are irreversible. An action this table does not name is `external` (fail-closed).
 */
const DELEGATE_CLASSES: Record<DelegateAction | 'start', CallClass> = {
  start: { effect: 'session' },
  list: { effect: 'read' },
  message: { effect: 'session' },
  stop: { effect: 'session', irreversible: true },
  close: { effect: 'session', irreversible: true },
}

/**
 * The runtime's pre-validation hook. Starting is the action with no name, and models name it
 * anyway (Haiku 5.5 sent `action: "start"` in LOCALIX-195 and LOCALIX-197): it is read as the
 * omitted action it means.
 */
export function prepareDelegateArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { action, ...rest } = raw as { action?: unknown }
  return action === 'start' ? rest : raw
}

export function classifyDelegateCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action ?? 'start'
  return typeof action === 'string' && Object.hasOwn(DELEGATE_CLASSES, action)
    ? DELEGATE_CLASSES[action as DelegateAction]
    : { effect: 'external' }
}

/**
 * The agent a new task runs as, as a permission rule names it (`Agent(Explore)` in a skill's
 * `allowed-tools`): a start that names one. Running it yourself, and every other action, names
 * none.
 */
export function delegatePermissionResources(input: unknown): string[] {
  const record = (input ?? {}) as { action?: unknown; agent?: unknown; context?: unknown }
  if (record.action !== undefined) return []
  // Both spellings of a fork are the one agent a rule can name.
  if (asksForFork(record)) return [FORK_AGENT]
  return typeof record.agent === 'string' && record.agent.trim() ? [record.agent.trim()] : []
}

export function createDelegateTool(port: DelegateToolPort) {
  return defineAgentTool<DelegateToolInput>({
    name: TOOL.delegate,
    label: 'Delegate',
    activeVerb: 'Delegating',
    description: [
      'Hand one well-scoped task to a child session, run by you or an agent from the directory (`agent`): broad investigations, reviews, long independent work — their detail stays out of this context. It sees only the task, so state what it needs; or context:"fork" (agent:"fork"): a copy of you that has seen everything you have, on your model and tools, for work that needs all of your context — it cannot fork or delegate again, and model, effort and agent do not apply. Its report arrives as a new message; integrate it. wait:true returns the report as this result instead — only when your next step needs it. 3 run at once; the rest wait.',
      'message amends a child (a finished one runs again and reports again); prefer it to a new task for follow-ups. stop ends a current run; close ends a child for good. list only to recover a missed report, never to poll.',
    ].join(' '),
    inputSchema,
    prepareArguments: prepareDelegateArguments,
    mutates: true,
    executionMode: 'sequential',
    classify: classifyDelegateCall,
    permissionResources: delegatePermissionResources,
    async execute(toolCallId, input, signal) {
      switch (input.action) {
        case undefined:
          if (!input.task || !input.title) {
            return { content: 'Starting a task requires task and title.', isError: true }
          }
          return port.delegate(toolCallId, startRequest(input, input.task, input.title), signal)
        case 'list':
          return listDelegations(port)
        case 'message':
          if (typeof input.run !== 'string') {
            return { content: 'action:"message" requires run: one child.', isError: true }
          }
          if (!input.message) {
            return { content: 'action:"message" requires message.', isError: true }
          }
          return messageRun(port, input.run, input.message, input.interrupt)
        case 'stop':
        case 'close': {
          if (!input.run) {
            return { content: `action:"${input.action}" requires run.`, isError: true }
          }
          const act = input.action === 'stop' ? stopRun : closeRun
          return eachRun(input.run, (ref) => act(port, ref))
        }
      }
    },
  })
}

/**
 * The request a start becomes. A fork is the delegator itself, so what would choose another agent,
 * model or effort is dropped here, once, for both spellings; the folder and the wait stay.
 */
function startRequest(input: DelegateToolInput, task: string, title: string): DelegateRequest {
  const base = { task, title, wait: input.wait ?? false }
  const isolation = input.isolation ? { isolation: input.isolation } : {}
  if (asksForFork(input)) return { ...base, context: 'fork', ...isolation }
  return {
    ...base,
    ...(input.agent ? { agent: input.agent } : {}),
    context: 'none',
    ...(input.effort ? { effort: input.effort } : {}),
    ...isolation,
    ...hostModel(input),
  }
}

/** The child's model the call names, or a host set on it (`DelegateRequest.model`). */
const hostModel = (input: object): { model?: string } => {
  const model = (input as { model?: unknown }).model
  return typeof model === 'string' && model ? { model } : {}
}
