import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'
import { DELEGATION_PRIORITIES, type DelegationPriority } from '../delegation-lanes'
import { DELEGATION_FANOUT } from '../delegation-hierarchy'
import {
  MAX_TASKS_PER_DELEGATION,
  type DelegationBrief,
  type TaskDelegationResult,
} from './task-delegation'
import {
  closeRun,
  formatUsage,
  messageRun,
  stopRun,
  type ChildCloseResult,
  type ChildMessageDelivery,
} from './agents-control'

/**
 * `agents` — the delegator's whole line to its children, in five actions:
 *
 *   delegate  one call, 1–6 tasks: each a brief for one agent or a team, with a REQUIRED priority
 *   runs      every child this session delegated: status, priority, place in the queue
 *   message   amend a child's brief — joins its running step, or runs it again
 *   stop      end the current run of one or more children (they can be messaged later)
 *   close     end one or more children for good — nothing wakes them after
 *
 * Shaped to cost the fewest model turns: independent tasks go out in ONE delegate call, and
 * finished children are closed in one call, instead of a turn per child. A child reports on its
 * own each time a run the delegator waits on finishes or fails, so nothing here is for polling.
 */

const AGENTS_ACTIONS = ['runs', 'delegate', 'message', 'stop', 'close'] as const
export type AgentsAction = (typeof AGENTS_ACTIONS)[number]
export interface DelegatedRunSummary {
  sessionId: string
  taskName: string
  status: string
  agentId?: string
  updatedAt?: string
  progress?: string
  reportAvailable?: boolean
  /** The task's priority — the order it takes in the queue when children wait for a slot. */
  priority?: DelegationPriority
  /** What the child has consumed across all its runs; cost is null where nothing was priced. */
  usage?: { tokens: number; costUsd: number | null }
  /**
   * How far below the reader it sits: 1 for a child it delegated, 2 for that child's child.
   * The reader SEES its whole subtree but manages only level 1 (`agents-control.ts`).
   */
  level?: number
  /** The session that delegated it — for a deeper row, the child that owns it. */
  parentSessionId?: string
}

export interface AgentsToolOptions {
  listRuns: () => Promise<DelegatedRunSummary[]>
  delegate: (toolCallId: string, briefs: DelegationBrief[]) => Promise<TaskDelegationResult>
  /** Message a child: joins its running step, or starts a new run (`agents-control.ts`). */
  message: (
    sessionId: string,
    text: string,
    priority?: DelegationPriority,
    interrupt?: boolean,
  ) => Promise<ChildMessageDelivery>
  /** Request that a running child stop. A stopped run reports nothing; the delegator stops waiting. */
  stop: (sessionId: string) => Promise<void>
  /** Close a child for good: stopped, and never woken again by anyone. */
  close: (sessionId: string) => Promise<ChildCloseResult>
}

const priority = z.enum(DELEGATION_PRIORITIES)

const taskSchema = z
  .object({
    agents: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(DELEGATION_FANOUT[0])
      .describe('Who runs it, by id or handle; several share one session as a team.'),
    title: z.string().trim().min(1).max(120).describe('A short task name.'),
    prompt: z
      .string()
      .trim()
      .min(1)
      .describe(
        'The whole assignment — goal, scope, constraints, files and done criteria. The child sees nothing else.',
      ),
    priority: priority.describe(
      'How urgent: high runs first when tasks wait for one of the 3 slots, low last.',
    ),
  })
  .strict()

const runRef = z.string().trim().min(1)

const inputSchema = z
  .object({
    action: z.enum(AGENTS_ACTIONS),
    tasks: z
      .array(taskSchema)
      .min(1)
      .max(MAX_TASKS_PER_DELEGATION)
      .optional()
      .describe(`delegate: 1–${MAX_TASKS_PER_DELEGATION} independent tasks.`),
    run: z
      .union([runRef, z.array(runRef).min(1).max(24)])
      .optional()
      .describe('Child session id or task name; stop/close accept a list.'),
    message: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .optional()
      .describe('message: what the child should know, change or do next — it amends the brief.'),
    priority: priority
      .optional()
      .describe('message: replaces the task priority; omit to keep the one it was delegated with.'),
    interrupt: z
      .boolean()
      .optional()
      .describe(
        'message: stop the running child now and restart it with this message — only when its current work is wrong.',
      ),
  })
  .strict()
type AgentsToolInput = z.infer<typeof inputSchema>

function formatRun(run: DelegatedRunSummary): string {
  // Deeper rows are indented under their owner and say they are not this session's to manage.
  const level = run.level ?? 1
  return [
    `${'  '.repeat(level - 1)}- \`${run.taskName}\` · ${run.status} · session ${run.sessionId}`,
    level > 1 ? 'managed by its parent' : '',
    run.priority ? `priority ${run.priority}` : '',
    formatUsage(run.usage),
    run.agentId,
    run.updatedAt,
    run.progress,
    run.reportAvailable ? 'Report available for review' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The subtree as a tree: each row followed by the rows it owns, so indentation reads as
 * ownership. A row whose owner is not in the list is a top row — this session's own child.
 */
function inTreeOrder(runs: readonly DelegatedRunSummary[]): DelegatedRunSummary[] {
  const ids = new Set(runs.map((run) => run.sessionId))
  const byOwner = new Map<string | undefined, DelegatedRunSummary[]>()
  for (const run of runs) {
    const owner =
      run.parentSessionId && ids.has(run.parentSessionId) ? run.parentSessionId : undefined
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), run])
  }
  const out: DelegatedRunSummary[] = []
  const seen = new Set<string>()
  const visit = (owner: string | undefined) => {
    for (const run of byOwner.get(owner) ?? []) {
      if (seen.has(run.sessionId)) continue
      seen.add(run.sessionId)
      out.push(run)
      visit(run.sessionId)
    }
  }
  visit(undefined)
  return out
}

/** What the whole subtree has consumed — the bill the reader's delegation put in motion. */
function totalUsage(runs: readonly DelegatedRunSummary[]): DelegatedRunSummary['usage'] {
  const priced = runs.filter((run) => run.usage?.costUsd != null)
  return {
    tokens: runs.reduce((sum, run) => sum + (run.usage?.tokens ?? 0), 0),
    costUsd: priced.length ? priced.reduce((sum, run) => sum + run.usage!.costUsd!, 0) : null,
  }
}

/** stop/close over one child or several: every child answered, in the order named. */
async function eachRun(
  refs: string | readonly string[],
  act: (ref: string) => Promise<{ content: string; isError?: boolean }>,
): Promise<{ content: string; isError?: boolean }> {
  const list = typeof refs === 'string' ? [refs] : refs
  const answers = []
  for (const ref of list) answers.push(await act(ref))
  return {
    content: answers.map((answer) => answer.content).join('\n'),
    ...(answers.every((answer) => answer.isError) ? { isError: true } : {}),
  }
}

/**
 * One `agents` call's class. Every child is a session this conversation owns, so the writes
 * are `session` — a plan session may still delegate a read-only investigation. `stop` ends a
 * run in flight and `close` ends a child for good; neither can be taken back, so both are
 * irreversible. An action this table does not name is `external` (fail-closed).
 */
const AGENTS_CLASSES: Record<AgentsAction, CallClass> = {
  runs: { effect: 'read' },
  delegate: { effect: 'session' },
  message: { effect: 'session' },
  stop: { effect: 'session', irreversible: true },
  close: { effect: 'session', irreversible: true },
}

export function classifyAgentsCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action
  return typeof action === 'string' && Object.hasOwn(AGENTS_CLASSES, action)
    ? AGENTS_CLASSES[action as AgentsAction]
    : { effect: 'external' }
}

/** Delegated-run history, task delegation, and a standing line to each delegated child. */
export function createAgentsTool(options: AgentsToolOptions) {
  return defineAgentTool<AgentsToolInput>({
    name: TOOL.agents,
    label: 'Agents',
    activeVerb: 'Working with agents',
    // WHEN to delegate rather than do it or invite a participant is the prompt's
    // "# Collaboration" rule; this says what a delegation is.
    description: [
      'Only root chats can delegate. Assignees automatically join this conversation, without a second chat run. Tasks execute in child sessions — one agent, or a team sharing one session. Put independent tasks in ONE delegate call; 3 run at once, the rest wait by priority.',
      'Each finished run reports automatically as a new message; use runs only to recover a missed report, never to poll.',
      'message amends a child (a finished one runs again and reports again) — prefer it to a new delegation for follow-ups. stop ends a current run; close ends a child for good.',
    ].join(' '),
    inputSchema,
    mutates: true,
    executionMode: 'sequential',
    classify: classifyAgentsCall,
    async execute(toolCallId, input) {
      switch (input.action) {
        case 'runs': {
          const runs = await options.listRuns()
          const delegated = inTreeOrder(runs.filter((run) => run.taskName !== '/root'))
          if (!delegated.length) return { content: 'No delegated runs in this session.' }
          const spent = formatUsage(totalUsage(delegated))
          return {
            content: [
              `**Delegated runs (${delegated.length})${spent ? ` — ${spent} in all` : ''}:**`,
              ...delegated.map(formatRun),
            ].join('\n'),
          }
        }
        case 'delegate':
          // Priority is REQUIRED per task (the schema says so): a default would make every task
          // `normal` and the queue an unordered FIFO again — the decision is the delegator's.
          if (!input.tasks?.length) {
            return {
              content:
                'action:"delegate" requires tasks: [{agents, title, prompt, priority}] (1–6 tasks).',
              isError: true,
            }
          }
          return options.delegate(toolCallId, input.tasks)
        case 'message':
          if (typeof input.run !== 'string') {
            return { content: 'action:"message" requires run: one child.', isError: true }
          }
          if (!input.message) {
            return { content: 'action:"message" requires message.', isError: true }
          }
          return messageRun(options, input.run, input.message, input.priority, input.interrupt)
        case 'stop':
        case 'close': {
          if (!input.run) {
            return { content: `action:"${input.action}" requires run.`, isError: true }
          }
          const act = input.action === 'stop' ? stopRun : closeRun
          return eachRun(input.run, (ref) => act(options, ref))
        }
      }
    },
  })
}
