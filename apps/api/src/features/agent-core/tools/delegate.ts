import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'
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
 * The child is the delegating agent itself, another enabled agent, or the delegating agent run as
 * a plugin's subagent type (`agent`, `delegate-plugin-agent.ts`). It starts from the
 * task alone, or with this conversation as filtered context (`context: "conversation"`,
 * `run/delegate-context.ts`). By default the call returns at once and the child's report arrives
 * as a later message; `wait: true` holds the call until the child reports
 * (`delegate-start.ts`).
 *
 *   (no action)  start: `task` + `title`, optionally `agent`, `context`, `wait`
 *   message      amend a child — joins its running step, or runs a finished one again
 *   stop         end the current run of one or more children (they can be messaged later)
 *   close        end one or more children for good — nothing wakes them after
 *   list         this session's children: status, queue place, spend
 */
export const DELEGATE_CONTEXTS = ['none', 'conversation'] as const
export type DelegateContext = (typeof DELEGATE_CONTEXTS)[number]

export interface DelegateRequest {
  task: string
  title: string
  /** Handle or id of the agent to run the task; the delegating agent itself when absent. */
  agent?: string
  context: DelegateContext
  wait: boolean
  /**
   * The child's model, an alias or an id, when the host picked one (a Claude Code mod's
   * `agent.spawn`); never a parameter the model passes. Absent, the child runs on the parent's.
   */
  model?: string
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
      .describe('Start: agent handle or agent type; omit to run it yourself.'),
    context: z
      .enum(DELEGATE_CONTEXTS)
      .optional()
      .describe('Start: what the child sees besides the task. Default none.'),
    wait: z.boolean().optional().describe('Start: hold this call until the report.'),
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
  const record = (input ?? {}) as { action?: unknown; agent?: unknown }
  return record.action === undefined && typeof record.agent === 'string' && record.agent.trim()
    ? [record.agent.trim()]
    : []
}

export function createDelegateTool(port: DelegateToolPort) {
  return defineAgentTool<DelegateToolInput>({
    name: TOOL.delegate,
    label: 'Delegate',
    activeVerb: 'Delegating',
    description: [
      'Hand one well-scoped task to a child session, run by you, a directory agent or an agent type (`agent`): broad investigations, reviews, long independent work — their detail stays out of this context. It sees only the task unless context:"conversation", so state what it needs. Its report arrives as a new message; integrate it. wait:true returns the report as this result instead — only when your next step needs it. 3 run at once; the rest wait.',
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
          return port.delegate(
            toolCallId,
            {
              task: input.task,
              title: input.title,
              ...(input.agent ? { agent: input.agent } : {}),
              context: input.context ?? 'none',
              wait: input.wait ?? false,
              ...hostModel(input),
            },
            signal,
          )
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

/** The child's model a host set on the call (`DelegateRequest.model`); the schema offers none. */
const hostModel = (input: object): { model?: string } => {
  const model = (input as { model?: unknown }).model
  return typeof model === 'string' && model ? { model } : {}
}
