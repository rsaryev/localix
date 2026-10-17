import type { DelegationPriority } from '../delegation-lanes'

/**
 * Talking to a delegated child after it started: list, message, stop, close.
 *
 * Delegation used to be fire-and-wait. The agent could list its children and nothing else, so a
 * task that turned out wrong ran to completion on the wrong premise, a follow-up meant a fresh
 * child that knew nothing the first had learned, and only a person could stop a runaway child. The
 * agent that delegated keeps a line to each child:
 *
 *   message — a running child reads it at its next step; an idle one runs again for it (in its
 *             turn, when the parent already has children running), same session, same memory;
 *   stop    — the running child stops this run; it can still be messaged later;
 *   close   — the child stops and is never woken again, by anyone.
 *
 * A run the parent is waiting on reports back when it finishes or fails, so the answer to a
 * message always arrives as a report; a stopped run reports nothing (`delegation-awaits.ts`). The
 * host answers what it can observe and no more — queued, requested — because a model told
 * "delivered" or "stopped" reasons as though it already happened.
 */

/** One child session of the reading session, as the host projects it. */
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
  /** How far below the reader it sits: 1 for its own child. Older trees may hold deeper rows. */
  level?: number
  /** The session that created it. */
  parentSessionId?: string
}

/** What the host's delivery answered, mirrored from `SubagentMessageDelivery` without importing chat. */
export type ChildMessageDelivery =
  | { delivered: true; state: 'running' }
  | { delivered: true; state: 'started' }
  | { delivered: true; state: 'interrupted' }
  | { delivered: true; state: 'queued'; position: number }
  | { delivered: false; reason: 'gone' | 'not-subagent' | 'closed' }

/** What closing answered, mirrored from `SubagentCloseResult`. */
export type ChildCloseResult =
  | { closed: true; wasRunning: boolean; alreadyClosed: boolean }
  | { closed: false; reason: 'gone' | 'not-subagent' }

export interface DelegateControlPorts {
  /** This session's own children — the only ones the tool resolves. */
  listRuns: () => Promise<DelegatedRunSummary[]>
  message: (sessionId: string, text: string, interrupt?: boolean) => Promise<ChildMessageDelivery>
  stop: (sessionId: string) => Promise<void>
  close: (sessionId: string) => Promise<ChildCloseResult>
}

export interface ToolAnswer {
  content: string
  isError?: boolean
}

/** A child of this session, named the way `list` prints it: session id or task name. */
async function resolveRun(
  ports: DelegateControlPorts,
  reference: string,
): Promise<DelegatedRunSummary | ToolAnswer> {
  const wanted = reference.trim()
  const run = (await ports.listRuns()).find(
    (candidate) => candidate.sessionId === wanted || candidate.taskName === wanted,
  )
  if (run && (run.level ?? 1) === 1) return run
  return {
    content: `No delegated task "${wanted}" in this conversation. Call action:"list" for the ids.`,
    isError: true,
  }
}

/** `12.4k tokens · $0.31` — the size of a child's bill at a glance, or nothing before its first run. */
export function formatUsage(usage: DelegatedRunSummary['usage']): string {
  if (!usage || usage.tokens <= 0) return ''
  const tokens =
    usage.tokens >= 1_000_000
      ? `${(usage.tokens / 1_000_000).toFixed(1)}M`
      : usage.tokens >= 1_000
        ? `${(usage.tokens / 1_000).toFixed(1)}k`
        : String(usage.tokens)
  const cost = usage.costUsd !== null && usage.costUsd > 0 ? ` · $${usage.costUsd.toFixed(2)}` : ''
  return `${tokens} tokens${cost}`
}

const isAnswer = (value: DelegatedRunSummary | ToolAnswer): value is ToolAnswer =>
  'content' in value

const closedAnswer = (run: DelegatedRunSummary): ToolAnswer => ({
  content: `\`${run.taskName}\` is closed and takes nothing more. Delegate again if the work continues.`,
  isError: true,
})

function formatRun(run: DelegatedRunSummary): string {
  return [
    `- \`${run.taskName}\` · ${run.status} · session ${run.sessionId}`,
    formatUsage(run.usage),
    run.updatedAt,
    run.progress,
    run.reportAvailable ? 'Report available for review' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** `list`: this session's children, with what they have spent in all. */
export async function listDelegations(ports: DelegateControlPorts): Promise<ToolAnswer> {
  const runs = (await ports.listRuns()).filter((run) => (run.level ?? 1) === 1)
  if (!runs.length) return { content: 'No delegated tasks in this session.' }
  const priced = runs.filter((run) => run.usage?.costUsd != null)
  const spent = formatUsage({
    tokens: runs.reduce((sum, run) => sum + (run.usage?.tokens ?? 0), 0),
    costUsd: priced.length ? priced.reduce((sum, run) => sum + run.usage!.costUsd!, 0) : null,
  })
  return {
    content: [
      `**Delegated tasks (${runs.length})${spent ? ` — ${spent} in all` : ''}:**`,
      ...runs.map(formatRun),
    ].join('\n'),
  }
}

export async function messageRun(
  ports: DelegateControlPorts,
  reference: string,
  text: string,
  /** Stop the child's current run now and restart it with this message. */
  interrupt?: boolean,
): Promise<ToolAnswer> {
  const run = await resolveRun(ports, reference)
  if (isAnswer(run)) return run
  if (run.status === 'closed') return closedAnswer(run)
  const delivery = await ports.message(run.sessionId, text, interrupt)
  if (!delivery.delivered) {
    return delivery.reason === 'closed'
      ? closedAnswer(run)
      : {
          content: `\`${run.taskName}\` could not take the message (${delivery.reason}).`,
          isError: true,
        }
  }
  // What the child has spent so far rides every answer, so the agent weighs another message
  // against the bill it is adding to — not after the report, when the next run is already paid.
  const spent = formatUsage(run.usage)
  const tail = `Its report arrives on its own when the run ends — do not wait on it.${
    spent ? ` It has used ${spent} so far.` : ''
  }`
  if (delivery.state === 'running')
    return {
      content: `Message queued for \`${run.taskName}\`: it reads it at its next step. ${tail}`,
    }
  if (delivery.state === 'started')
    return {
      content: `\`${run.taskName}\` had finished; your message starts a new run in the same session, with everything it already knows. ${tail}`,
    }
  if (delivery.state === 'interrupted')
    return {
      content: `Interrupted \`${run.taskName}\`: its current run is being stopped, and it restarts with your message — no report for the run it cut short. ${tail}`,
    }
  return {
    content: `\`${run.taskName}\` will run your message in its turn (position ${delivery.position}): other children are using the parallel slots. ${tail}`,
  }
}

export async function stopRun(ports: DelegateControlPorts, reference: string): Promise<ToolAnswer> {
  const run = await resolveRun(ports, reference)
  if (isAnswer(run)) return run
  if (run.status !== 'running') {
    return {
      content: `\`${run.taskName}\` is not running (${run.status}); there is nothing to stop.`,
      isError: true,
    }
  }
  await ports.stop(run.sessionId)
  return {
    content:
      `Stop requested for \`${run.taskName}\`. No report follows: a stopped run sends none, and you ` +
      'are no longer waiting on it. Message it to resume (that run reports); use action:"close" to end it for good.',
  }
}

export async function closeRun(
  ports: DelegateControlPorts,
  reference: string,
): Promise<ToolAnswer> {
  const run = await resolveRun(ports, reference)
  if (isAnswer(run)) return run
  const result = await ports.close(run.sessionId)
  if (!result.closed)
    return { content: `\`${run.taskName}\` could not be closed (${result.reason}).`, isError: true }
  if (result.alreadyClosed) return { content: `\`${run.taskName}\` was already closed.` }
  return {
    content:
      `Closed \`${run.taskName}\`${result.wasRunning ? ' and stopped its run' : ''}. ` +
      'Nothing wakes it again — no message, no queued work, no report. Its transcript stays readable.',
  }
}

/** stop/close over one child or several: every child answered, in the order named. */
export async function eachRun(
  refs: string | readonly string[],
  act: (ref: string) => Promise<ToolAnswer>,
): Promise<ToolAnswer> {
  const list = typeof refs === 'string' ? [refs] : refs
  const answers = []
  for (const ref of list) answers.push(await act(ref))
  return {
    content: answers.map((answer) => answer.content).join('\n'),
    ...(answers.every((answer) => answer.isError) ? { isError: true } : {}),
  }
}
