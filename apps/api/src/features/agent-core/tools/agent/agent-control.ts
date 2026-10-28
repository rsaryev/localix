import type { DelegationPriority } from '../../delegation-lanes'

/**
 * The line from an agent to the subagents it started: `SendMessage` amends one, `TaskStop` ends
 * its run.
 *
 *   message — a running subagent reads it at its next step; an idle one runs again for it (in its
 *             turn, when the parent already has subagents running), same session, same memory;
 *   stop    — the running subagent stops this run; it can still be messaged later.
 *
 * Listing and closing are not the model's: the running subagents are named in the prompt each
 * turn (`# Active sub-agents`), and a person closes one in the UI. A model that could list polled
 * with it (LOCALIX-180, LOCALIX-349) instead of waiting for the report.
 *
 * A run the parent is waiting on reports back when it finishes or fails, so the answer to a
 * message always arrives as a report; a stopped run reports nothing (`delegation-awaits.ts`). The
 * host answers what it can observe and no more — queued, requested — because a model told
 * "delivered" or "stopped" reasons as though it already happened.
 */

/** One child session of the reading session, as the host projects it. */
export interface ChildRunSummary {
  sessionId: string
  /** The addressable path the store derived from the title (`/root/audit_repo`). */
  taskName: string
  /** The description it was started with: what the person and the roster in the prompt call it. */
  title?: string
  /** The name the `Agent` call gave it, when it gave one: a way to reach it besides its id. */
  name?: string
  /** The `agent_type` it was started as (`Explore`, `general-purpose`, an agent file's name). */
  agentType?: string
  status: string
  /** Set by the host while the child waits for one of its parent's lanes (`status` reads `queued (#n)`). */
  waitingForLane?: boolean
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

export interface AgentControlPorts {
  /** This session's own children — the only ones the tools resolve. */
  listRuns: () => Promise<ChildRunSummary[]>
  message: (sessionId: string, text: string) => Promise<ChildMessageDelivery>
  stop: (sessionId: string) => Promise<void>
}

export interface ToolAnswer {
  content: string
  isError?: boolean
}

/** What a reference to one of the reader's children resolved to. */
export type ChildMatch =
  | { kind: 'found'; run: ChildRunSummary }
  | { kind: 'none'; runs: ChildRunSummary[] }

/**
 * A child of this session by its session id, or by the name its `Agent` call gave it (as in Claude
 * Code); the task path the store derived (absolute, or its last segment) names it too. A
 * description alone is not a name: a subagent started without one is reached by its id.
 */
export async function findChild(ports: AgentControlPorts, reference: string): Promise<ChildMatch> {
  const wanted = reference.trim()
  const runs = (await ports.listRuns()).filter((run) => (run.level ?? 1) === 1)
  const exact = runs.find(
    (run) =>
      run.sessionId === wanted ||
      run.name === wanted ||
      run.taskName === wanted ||
      run.taskName.split('/').pop() === wanted,
  )
  if (exact) return { kind: 'found', run: exact }
  return { kind: 'none', runs }
}

/** One child as the agent can name it: its id first, since that always names exactly one. */
const describeChild = (run: ChildRunSummary): string =>
  `- ${run.sessionId}${run.title ? ` "${run.title}"` : ''} (${run.taskName}): ${run.status}`

/** The children an answer offers, so a miss tells the agent what it could have meant. */
export function listChildren(runs: readonly ChildRunSummary[]): string {
  return runs.length === 0
    ? 'This conversation has started no subagents.'
    : `Subagents of this conversation:\n${runs.map(describeChild).join('\n')}`
}

export const noSuchChild = (reference: string, runs: readonly ChildRunSummary[]): ToolAnswer => ({
  content: `No subagent "${reference.trim()}" in this conversation. Name one by its id or its name.\n${listChildren(runs)}`,
  isError: true,
})

/** `12.4k tokens · $0.31` — the size of a child's bill at a glance, or nothing before its first run. */
export function formatUsage(usage: ChildRunSummary['usage']): string {
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

/** Claude Code's one-shot built-ins: they answer once and take no further message. */
const ONE_SHOT_TYPES = new Set(['Explore', 'Plan'])

const closedAnswer = (run: ChildRunSummary): ToolAnswer => ({
  content: `\`${run.taskName}\` is closed and takes nothing more. Start a new Agent if the work continues.`,
  isError: true,
})

export async function messageChild(
  ports: AgentControlPorts,
  reference: string,
  text: string,
): Promise<ToolAnswer> {
  const found = await findChild(ports, reference)
  if (found.kind === 'none') return noSuchChild(reference, found.runs)
  const { run } = found
  if (run.status === 'closed') return closedAnswer(run)
  if (run.agentType && ONE_SHOT_TYPES.has(run.agentType))
    return {
      content: `\`${run.taskName}\` is a one-shot ${run.agentType} agent: it answers once and cannot be messaged or resumed. Start a general-purpose Agent if the work continues.`,
      isError: true,
    }
  const delivery = await ports.message(run.sessionId, text)
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
  const tail = `You will be notified with its reply; do not wait or poll for it.${
    spent ? ` It has used ${spent} so far.` : ''
  }`
  if (delivery.state === 'running')
    return {
      content: `Message queued for \`${run.taskName}\`: it reads it at its next step. ${tail}`,
    }
  if (delivery.state === 'started')
    return {
      content: `\`${run.taskName}\` had finished; your message starts a new run in the same session, with everything it already knows. If its report of the run that had finished reaches you first, that report does not answer this message: the reply to it comes after. ${tail}`,
    }
  if (delivery.state === 'interrupted')
    return {
      content: `\`${run.taskName}\` restarts with your message; the run it cut short sends no reply. ${tail}`,
    }
  return {
    content: `\`${run.taskName}\` will run your message in its turn (position ${delivery.position}): other subagents are using the parallel slots. ${tail}`,
  }
}

export async function stopChild(
  ports: AgentControlPorts,
  run: ChildRunSummary,
): Promise<ToolAnswer> {
  if (run.waitingForLane) {
    await ports.stop(run.sessionId)
    return {
      content:
        `\`${run.taskName}\` was queued for a free slot (${run.status}) and is withdrawn from the ` +
        'queue: it does not start, and no reply follows. SendMessage to it starts it later.',
    }
  }
  if (run.status !== 'running') {
    return {
      content: `\`${run.taskName}\` is not running (${run.status}); there is nothing to stop.`,
      isError: true,
    }
  }
  await ports.stop(run.sessionId)
  return {
    content:
      `Stop requested for \`${run.taskName}\`, which was ${run.status}. No reply follows: a stopped run sends none. ` +
      'SendMessage to it resumes it with everything it knew.',
  }
}
