import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'
import type { TaskDelegationResult } from './task-delegation'
import {
  closeRun,
  eachRun,
  listForks,
  messageRun,
  stopRun,
  type ForkControlPorts,
} from './fork-control'

/**
 * `fork` — the speaking agent continues in a copy of itself, and keeps a line to each copy.
 *
 * A fork is the same agent, with the same role, carrying this conversation as of the call into a
 * child session, where it works on one task and reports back. That is what makes a fork cheap to
 * ask for: no brief has to restate what both copies already know. It is also the ONLY child work
 * an agent creates: agents do not hand work to other agents; another role joins the conversation.
 *
 *   (no action)  start a fork: `task` + `title`
 *   message      amend a fork — joins its running step, or runs a finished one again
 *   stop         end the current run of one or more forks (they can be messaged later)
 *   close        end one or more forks for good — nothing wakes them after
 *   list         this session's forks: status, queue place, spend
 */
export interface ForkRequest {
  task: string
  title: string
}

export interface ForkToolPort extends ForkControlPorts {
  fork(toolCallId: string, request: ForkRequest): Promise<TaskDelegationResult>
}

const FORK_ACTIONS = ['message', 'stop', 'close', 'list'] as const
type ForkAction = (typeof FORK_ACTIONS)[number]

const runRef = z.string().trim().min(1)

const inputSchema = z
  .object({
    action: z.enum(FORK_ACTIONS).optional().describe('Omit to start a fork.'),
    task: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .optional()
      .describe('Start: the goal and when it is done; the fork already knows this chat.'),
    title: z.string().trim().min(1).max(120).optional().describe('Start: short name.'),
    run: z
      .union([runRef, z.array(runRef).min(1).max(24)])
      .optional()
      .describe('Fork session id or task name; stop/close accept a list.'),
    message: z.string().trim().min(1).max(8000).optional().describe('message: what changes.'),
    interrupt: z
      .boolean()
      .optional()
      .describe('message: stop its current run and restart with this message.'),
  })
  .strict()
type ForkToolInput = z.infer<typeof inputSchema>

/**
 * One `fork` call's class. Every fork is a session this conversation owns, so the writes are
 * `session`. `stop` ends a run in flight and `close` ends a fork for good; neither can be taken
 * back, so both are irreversible. An action this table does not name is `external` (fail-closed).
 */
const FORK_CLASSES: Record<ForkAction | 'start', CallClass> = {
  start: { effect: 'session' },
  list: { effect: 'read' },
  message: { effect: 'session' },
  stop: { effect: 'session', irreversible: true },
  close: { effect: 'session', irreversible: true },
}

export function classifyForkCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action ?? 'start'
  return typeof action === 'string' && Object.hasOwn(FORK_CLASSES, action)
    ? FORK_CLASSES[action as ForkAction]
    : { effect: 'external' }
}

export function createForkTool(port: ForkToolPort) {
  return defineAgentTool<ForkToolInput>({
    name: TOOL.fork,
    label: 'Fork',
    activeVerb: 'Forking',
    description: [
      'Continue yourself in a child session that inherits this conversation and works on one task in parallel. Use it for searches, investigations and long or independent work, so their detail stays out of this context. Its report arrives on its own as a new message; integrate it. 3 run at once; the rest wait.',
      'message amends a fork (a finished one runs again and reports again); prefer it to a new fork for follow-ups. stop ends a current run; close ends a fork for good. list only to recover a missed report, never to poll.',
    ].join(' '),
    inputSchema,
    mutates: true,
    executionMode: 'sequential',
    classify: classifyForkCall,
    async execute(toolCallId, input) {
      switch (input.action) {
        case undefined:
          if (!input.task || !input.title) {
            return { content: 'Starting a fork requires task and title.', isError: true }
          }
          return port.fork(toolCallId, { task: input.task, title: input.title })
        case 'list':
          return listForks(port)
        case 'message':
          if (typeof input.run !== 'string') {
            return { content: 'action:"message" requires run: one fork.', isError: true }
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
