import type { PresentedError } from '@localixai/agent/agents'

import type { ProviderConditions } from '../conditions/providers'
import type { NotificationJournal } from '../journal'
import type { InboxAction } from '../contracts'
import { recoveryAction } from '../recovery'
import {
  isInternalSession,
  openChatAction,
  resourceOrigin,
  type OrderedLane,
  type SessionFacts,
} from './facts'

/**
 * HOW A RUN ENDED, recorded once at its LOGICAL end.
 *
 * A run has many segments — a transient retry, a compact-and-rerun, a Stop-hook continuation —
 * and a row per segment reported a failure that the next segment recovered from. So this is called
 * only where no segment follows (after `maybeStartContinuation` declined, after both retries
 * declined), and the row is keyed by the run's assistant message so a replay is the same row.
 *
 * Which endings raise nothing, and why:
 *   - a STOPPED run (Stop, a send that replaced it, a withdrawn wake): someone chose it;
 *   - an externally-driven turn (a plugin channel, the API server): the channel shows its reply;
 *   - an internal hook-verifier job: the hook that ran it reports it;
 *   - a completion while more turns are queued: the agent is not waiting on the person yet — the
 *     last turn of the queue reports;
 *   - a completion of a nested chat (a fork, a thread): only a top-level chat's finish is news.
 * A slash command's synthetic reply never reaches this seam: it is no run.
 *
 * Failures are settled by what supersedes them — a later run of the same session, or a regenerate
 * — because Retry rewrites the session's LATEST reply, and a Retry offered after a newer turn
 * rewrites that newer turn. They share the prefix `run-failed:<sessionId>:` so one settle finds them.
 */

export interface RunEnded {
  userId: string
  session: SessionFacts
  /** The run's assistant message id: the identity a Retry and the transcript both know. */
  runId: string
  outcome: 'completed' | 'failed' | 'stopped'
  /**
   * The failure as `presentErrorInfo` worded it — the same reason and recovery the transcript
   * notice shows, so the row and the line cannot disagree. Redacted at the classification.
   */
  presented?: PresentedError
  /** The invocation host; `'channel'` for an externally-driven turn. */
  invocation?: string
  /** Whether turns are still queued for this session (the next one reports instead). */
  hasQueuedTurns?: () => Promise<boolean>
  /** A parent's cascading stop took this run down; its own "stopped" row would be noise. */
  cascaded?: boolean
  /** The provider connection the run went out on (`null`: none resolved). */
  connectionId?: string | null
  /** How the classifier read the failure — what makes it the connection's problem. */
  failure?: { rateLimited?: boolean; retryable?: boolean; authFailed?: boolean }
}

export interface RunNotifications {
  ended(run: RunEnded): void
  /** A regenerate was accepted: the failure it retries is no longer actionable. */
  retried(userId: string, sessionId: string): void
}

export const runKey = (sessionId: string, runId: string) => `run:${sessionId}:${runId}`
export const failurePrefix = (sessionId: string) => `run-failed:${sessionId}:`
export const failureKey = (sessionId: string, runId: string) =>
  `${failurePrefix(sessionId)}${runId}`
export const childKey = (sessionId: string, runId: string) => `child:${sessionId}:${runId}`

const CHILD = {
  completed: { topic: 'child.completed', severity: 'success', title: 'Sub-agent finished' },
  failed: {
    topic: 'child.failed',
    severity: 'error',
    title: 'Could not finish a sub-agent’s task',
  },
  // A stop is neither a success nor a failure, and someone chose it: recorded, never raised.
  stopped: { topic: 'child.stopped', severity: 'info', title: 'Sub-agent stopped' },
} as const

function retryAction(session: SessionFacts, runId: string): InboxAction {
  return {
    id: 'retry',
    label: 'Retry',
    kind: 'invoke',
    command: 'retry_run',
    target: { kind: 'session', sessionId: session.id, projectId: session.projectId },
    runId,
    available: true,
  }
}

/** "Could not …", naming the conversation — the wording rule for every failure row. */
function failureTitle(session: SessionFacts): string {
  const title = session.title?.trim()
  return title ? `Could not finish the reply in “${title}”` : 'Could not finish the reply'
}

/**
 * The row's controls, from the same recovery the transcript notice offers: open the chat, then
 * Retry only when the presentation says a retry can help, then whatever else it names (the
 * provider settings for a spent plan). A Retry offered for every failure was the defect.
 */
function failureActions(
  session: SessionFacts,
  runId: string,
  presented: PresentedError | undefined,
): InboxAction[] {
  const recoveries = presented?.actions ?? ['retry']
  return [
    openChatAction(session),
    ...recoveries.map((recovery) =>
      recovery === 'retry' ? retryAction(session, runId) : recoveryAction(recovery),
    ),
  ]
}

export function createRunNotifications(deps: {
  journal: NotificationJournal
  lane: OrderedLane
  /** The connection conditions; ONE instance shared with the OAuth refresh path (`infra.ts`). */
  provider?: Pick<ProviderConditions, 'runEnded'>
}): RunNotifications {
  const { journal, lane } = deps

  /**
   * ONE ROW PER PROBLEM. A refused key or a spent quota fails every run on the connection, and
   * each failure raised its own run row beside the connection's standing condition — the same
   * fact twice, then once more per turn. When the connection's condition is what failed the run
   * (`conditions/providers.ts` raises it from this same end), that condition IS the row: it
   * names the cause, carries the sign-in or settings action, and settles when the connection
   * works. The run's own row is kept for every failure that is the run's.
   */
  const connectionOwns = (run: RunEnded): boolean =>
    Boolean(
      deps.provider &&
      run.connectionId &&
      run.outcome === 'failed' &&
      (run.failure?.authFailed || run.failure?.rateLimited),
    )

  function childEnded(run: RunEnded) {
    // Stopping a parent stops every child it spawned; the person did ONE thing, and a quiet row
    // per child said it N more times. A child stopped on its own still records its stop.
    if (run.outcome === 'stopped' && run.cascaded) return
    if (connectionOwns(run)) return
    const shape = CHILD[run.outcome]
    journal.record(run.userId, {
      key: childKey(run.session.id, run.runId),
      topic: shape.topic,
      category: 'agent',
      severity: shape.severity,
      title: shape.title,
      body: [run.session.title, run.outcome === 'failed' && run.presented?.reason]
        .filter(Boolean)
        .join('\n'),
      origin: resourceOrigin(run.session, 'run', run.runId, 'Sub-agent'),
      actions: [openChatAction(run.session)],
    })
  }

  async function chatEnded(run: RunEnded, queued: Promise<boolean>) {
    const { userId, session, runId } = run
    // Whatever this run's outcome, an earlier failure's Retry would now rewrite THIS turn.
    journal.settle(userId, {
      prefix: failurePrefix(session.id),
      keep: failureKey(session.id, runId),
      reason: run.outcome === 'completed' ? 'completed' : 'superseded',
    })
    if (run.outcome === 'failed') {
      if (connectionOwns(run)) return
      journal.record(userId, {
        key: failureKey(session.id, runId),
        topic: 'run.failed',
        category: 'agent',
        severity: 'error',
        title: failureTitle(session),
        body: run.presented?.reason ?? 'The run stopped on an unexpected error.',
        origin: resourceOrigin(session, 'run', runId, 'Agent run'),
        actions: failureActions(session, runId, run.presented),
      })
      return
    }
    if (run.outcome !== 'completed' || session.parentSessionId) return
    if (await queued) return
    journal.record(userId, {
      key: runKey(session.id, runId),
      topic: 'run.completed',
      category: 'agent',
      severity: 'success',
      title: 'Agent run finished',
      body: session.title,
      origin: resourceOrigin(session, 'run', runId, 'Agent run'),
      actions: [openChatAction(session)],
    })
  }

  return {
    ended(run) {
      // The CONNECTION's fact comes first and from every kind of run — a channel turn or a
      // sub-agent spends the same quota a chat does (`conditions/providers.ts`).
      if (deps.provider && run.connectionId !== undefined) {
        const connectionRun = {
          userId: run.userId,
          connectionId: run.connectionId,
          outcome: run.outcome,
          ...(run.failure ? { failure: run.failure } : {}),
        }
        lane.run(() => deps.provider!.runEnded(connectionRun))
      }
      if (run.invocation === 'channel' || isInternalSession(run.session)) return
      const kind = run.session.sessionKind
      if (kind === 'subagent' || kind === 'job') {
        lane.run(() => childEnded(run))
        return
      }
      if (kind !== 'chat') return
      // Asked NOW, not when the lane gets to it: by then the run's teardown may have started
      // draining the queue, and a drained queue reads as "nothing queued" — the very turn that
      // should report instead would be the reason this one did.
      let queued = Promise.resolve(false)
      if (run.outcome === 'completed' && run.hasQueuedTurns) {
        try {
          queued = run.hasQueuedTurns().catch(() => false)
        } catch {
          /* an unreadable queue reads as empty: the run reports */
        }
      }
      // A stopped chat run still settles: its partial reply is now the one a Retry would rewrite.
      lane.run(() => chatEnded(run, queued))
    },
    retried(userId, sessionId) {
      lane.run(() =>
        journal.settle(userId, { prefix: failurePrefix(sessionId), reason: 'retried' }),
      )
    },
  }
}
