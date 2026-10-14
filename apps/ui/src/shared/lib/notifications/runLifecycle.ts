/**
 * RETRYING A FAILED RUN FROM ITS ROW, safely.
 *
 * Retry regenerates the session's LATEST reply, so a click after a newer turn (or after a
 * `/usage`) would silently rewrite that newer reply instead of the failed one. So Retry names the
 * run it was offered for, and the server refuses when that run is no longer the reply a regenerate
 * would rewrite — checked atomically there, not read-then-act here.
 *
 * Recording and settling the failure rows themselves is the server's (the journal settles a
 * session's failures when a later run starts); this module only settles the ONE row it was clicked
 * on, the moment it knows that row can no longer act.
 */
import type { SettleReason } from '@localixai/api/notification-contracts'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import type { NotificationAction, NotificationEntry, NotificationSeverity } from './types'

/** The run a failure row was recorded for — carried by the row, so it survives a reload. */
export interface FailedRun {
  sessionId: string
  projectId: string | null
  runId?: string
}

export function failedRunOf(
  entry: NotificationEntry,
  action?: NotificationAction,
): FailedRun | null {
  const origin = entry.origin
  const target = action?.target
  const sessionId = target?.sessionId ?? (origin.kind === 'application' ? null : origin.sessionId)
  if (!sessionId) return null
  const runId =
    action?.runId ??
    (origin.kind === 'resource' && origin.resourceKind === 'run' ? origin.resourceId : undefined)
  return {
    sessionId,
    projectId: target?.projectId ?? (origin.kind === 'application' ? null : origin.projectId),
    ...(runId ? { runId } : {}),
  }
}

/**
 * How a Retry ended. The two refusals are the SERVER's: it checks, under the same lock that
 * serializes new turns, that the named reply is still the one a regenerate would rewrite. A
 * client that read the session first and regenerated second left a window in which a new reply
 * could land and be rewritten instead.
 */
export type RetryOutcome = 'accepted' | 'failed' | 'superseded' | 'no_reply'

const REFUSAL: Record<'superseded' | 'no_reply', [string, string]> = {
  superseded: [
    'This run is no longer the latest reply',
    'Retry regenerates only the latest reply, so it would rewrite newer work. Open the chat to continue from there.',
  ],
  no_reply: [
    'This run left no reply to retry',
    'It failed before writing anything, and Retry would rewrite an earlier reply instead. Send the message again from the chat.',
  ],
}

export interface RetryFailedRunDeps {
  /**
   * Starts the regenerate for `run` (naming `run.runId`, so the server can refuse) and reports its
   * own transport failure. The default is the bare RPC — the chat host passes one that also paints
   * the running state.
   */
  regenerate?: (run: FailedRun) => Promise<RetryOutcome>
  report: (severity: NotificationSeverity, title: string, body: string, run: FailedRun) => void
  /** Settle the row the Retry was clicked on: its Retry can no longer do what it says. */
  settle?: (reason: SettleReason) => void
}

const REFUSAL_CODES: Record<string, 'superseded' | 'no_reply'> = {
  regenerate_superseded: 'superseded',
  regenerate_no_reply: 'no_reply',
}

/** Regenerate the named run → the server accepts or refuses → settle or explain the row. */
export async function retryFailedRun(run: FailedRun, deps: RetryFailedRunDeps): Promise<boolean> {
  const {
    regenerate = (target: FailedRun) =>
      backendClient.regenerate(target.sessionId, target.projectId, target.runId).then(
        (): RetryOutcome => 'accepted',
        (error: unknown): RetryOutcome => {
          const refusal = error instanceof ApiError && error.code && REFUSAL_CODES[error.code]
          if (refusal) return refusal
          deps.report('error', 'Could not retry the agent run', errorMessage(error, ''), target)
          return 'failed'
        },
      ),
  } = deps
  const outcome = await regenerate(run)
  if (outcome === 'superseded' || outcome === 'no_reply') {
    // Its Retry can never do what it says now: a newer reply would be rewritten instead.
    deps.settle?.('superseded')
    const [title, body] = REFUSAL[outcome]
    deps.report('info', title, body, run)
    return false
  }
  // A failed regenerate leaves the row live, so the person can try again from it.
  if (outcome === 'accepted') deps.settle?.('retried')
  return outcome === 'accepted'
}
