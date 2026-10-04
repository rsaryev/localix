import type { DelegatedRunSummary } from './agents'
import type { DelegationPriority } from '../delegation-lanes'

/**
 * Talking to a delegated child after the delegation: message it, stop it, close it.
 *
 * A delegation used to be fire-and-wait. The delegator could list its children and nothing else,
 * so a brief that turned out wrong ran to completion on the wrong premise, a follow-up meant a
 * fresh child that knew nothing the first had learned, and only a person could stop a runaway
 * child. Now the agent that started a child keeps a line to it:
 *
 *   message — a running child reads it at its next step; an idle one runs again for it (in its
 *             turn, when the parent already has children running), same session, same memory;
 *   stop    — the running child stops this run; it can still be messaged later;
 *   close   — the child stops and is never woken again, by anyone.
 *
 * A run the delegator is waiting on reports back when it finishes or fails, so the answer to a
 * message always arrives as a report; a stopped run reports nothing (`delegation-awaits.ts`). The host answers what it can observe and no more — queued, requested — because a model
 * told "delivered" or "stopped" reasons as though it already happened.
 */

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

export interface AgentsControlPorts {
  listRuns: () => Promise<DelegatedRunSummary[]>
  message: (
    sessionId: string,
    text: string,
    priority?: DelegationPriority,
    interrupt?: boolean,
  ) => Promise<ChildMessageDelivery>
  stop: (sessionId: string) => Promise<void>
  close: (sessionId: string) => Promise<ChildCloseResult>
}

interface ToolAnswer {
  content: string
  isError?: boolean
}

/** A child of this conversation, named the way `runs` prints it: session id or task name. */
async function resolveRun(
  ports: AgentsControlPorts,
  reference: string,
): Promise<DelegatedRunSummary | ToolAnswer> {
  const wanted = reference.trim()
  const runs = (await ports.listRuns()).filter((run) => run.taskName !== '/root')
  const run = runs.find(
    (candidate) => candidate.sessionId === wanted || candidate.taskName === wanted,
  )
  if (!run) {
    return {
      content: `No delegated run "${wanted}" in this conversation. Call action:"runs" for the ids.`,
      isError: true,
    }
  }
  // The reader SEES its whole subtree but manages one level: a deeper run is its owner's to
  // message, stop or close. Reaching past the owner is how two delegators end up steering one
  // child in different directions — the owner would integrate work it never redirected.
  if ((run.level ?? 1) > 1) {
    const owner = runs.find((candidate) => candidate.sessionId === run.parentSessionId)
    return {
      content:
        `\`${run.taskName}\` was delegated by \`${owner?.taskName ?? run.parentSessionId}\`, not by you, ` +
        'so only it can manage it. Message that child instead.',
      isError: true,
    }
  }
  return run
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
  content: `\`${run.taskName}\` is closed and takes nothing more. Delegate a new sub-agent if the work continues.`,
  isError: true,
})

export async function messageRun(
  ports: AgentsControlPorts,
  reference: string,
  text: string,
  /** Replaces the task's priority; absent keeps the one it was delegated with. */
  priority?: DelegationPriority,
  /** Stop the child's current run now and restart it with this message. */
  interrupt?: boolean,
): Promise<ToolAnswer> {
  const run = await resolveRun(ports, reference)
  if (isAnswer(run)) return run
  if (run.status === 'closed') return closedAnswer(run)
  const delivery = await ports.message(run.sessionId, text, priority, interrupt)
  if (!delivery.delivered) {
    return delivery.reason === 'closed'
      ? closedAnswer(run)
      : {
          content: `\`${run.taskName}\` could not take the message (${delivery.reason}).`,
          isError: true,
        }
  }
  // What the child has spent so far rides every answer, so the delegator weighs another message
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
    content: `\`${run.taskName}\` will run your message in its turn (position ${delivery.position}): other sub-agents are using the parallel slots. ${tail}`,
  }
}

export async function stopRun(ports: AgentsControlPorts, reference: string): Promise<ToolAnswer> {
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
      'are no longer waiting on it. Message it to resume (that run reports); use action="close" to end it for good.',
  }
}

export async function closeRun(ports: AgentsControlPorts, reference: string): Promise<ToolAnswer> {
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
