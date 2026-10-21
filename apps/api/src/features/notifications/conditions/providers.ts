import { errorMessage } from '../../../lib/errors'
import { recoveryAction } from '../recovery'
import { createConditions, type ConditionJournal } from './condition'

/**
 * A PROVIDER CONNECTION THAT CAN NO LONGER SIGN IN, as a standing condition.
 *
 * An OAuth connection refreshes its token under the credential store's lock
 * (`provider-connections/service.ts` `modify`). When the refresh fails — a revoked grant, a rotated
 * refresh token that was already spent — every run on that connection fails the same way until the
 * person signs in again, and each failure said so only on its own run. The service reports each
 * refresh's outcome here.
 *
 * Subject `provider:<connectionId>:`. It settles on the next refresh that succeeds, and on a new
 * sign-in for the connection (`persistOAuthCredential`), which is what fixing it looks like. A
 * cancelled request (the run was stopped) is not a sign-in failure and is not reported.
 */

export interface ProviderCredentialEvent {
  userId: string
  connectionId: string
  /** Shown as the row's source: the provider's name when known, else its id. */
  label: string
  ok: boolean
  error?: string
}

/**
 * How a run on a connection ended, as far as the CONNECTION is concerned.
 *
 * A spent quota or a refused key fails every run on the connection the same way, and each failure
 * said so only on its own run row — the person learned it once per turn and never as "this
 * connection is the problem". So a run's end is also a fact about its connection: a rate limit or
 * a refused credential raises the connection's condition, and any run that COMPLETES on it settles
 * whatever the connection's row still says (including an expired sign-in: it evidently works).
 */
export interface ConnectionRunEnded {
  userId: string
  connectionId: string | null
  outcome: 'completed' | 'failed' | 'stopped'
  /**
   * The classifier's flags only. Its message used to ride along into the row's body, which is
   * how a provider's raw response reached the Event Center under a heading that already said
   * what was wrong; the body below says it in a sentence this module owns.
   */
  failure?: { rateLimited?: boolean; retryable?: boolean; authFailed?: boolean }
}

/** The subject of a connection whose account sign-in is gone: one row per connection. */
const REMOVED_SIGN_IN = 'provider-sign-in-removed'

export function createProviderConditions(
  journal: ConditionJournal,
  /** The connection's display name, when it can be looked up; the id otherwise. */
  describe?: (userId: string, connectionId: string) => Promise<string | undefined>,
) {
  const conditions = createConditions(journal)
  const labelOf = async (userId: string, connectionId: string) =>
    (await describe?.(userId, connectionId).catch(() => undefined)) ?? connectionId
  return {
    async runEnded(run: ConnectionRunEnded): Promise<void> {
      if (!run.connectionId) return
      const subject = ['provider', run.connectionId]
      if (run.outcome === 'completed') return conditions.clear(run.userId, subject)
      const failure = run.outcome === 'failed' ? run.failure : undefined
      if (!failure?.authFailed && !failure?.rateLimited) return
      const label = await labelOf(run.userId, run.connectionId)
      conditions.raise(run.userId, {
        subject,
        problem: failure.authFailed
          ? 'credential-refused'
          : failure.retryable
            ? 'rate-limited'
            : 'plan-limit',
        severity: failure.authFailed || !failure.retryable ? 'error' : 'warning',
        title: failure.authFailed
          ? `Could not sign in to ${label}`
          : failure.retryable
            ? `${label} is rate-limiting requests`
            : `${label} has reached its usage limit`,
        body: failure.authFailed
          ? 'Every request on this connection is refused until its key or sign-in is fixed.'
          : failure.retryable
            ? 'Runs on this connection wait for the limit to reset before they send again.'
            : 'Runs on this connection fail until the plan resets or is raised.',
        origin: { kind: 'application', label },
        actions: [
          recoveryAction(
            failure.authFailed ? `sign-in:${run.connectionId}` : 'open-settings:providers',
          ),
        ],
      })
    },
    /**
     * OAuth connections whose provider Localix no longer signs in to with an account (the sign-ins
     * that left with the vendored runtime: Anthropic, Kimi Coding, Meta, xAI, Radius). Every run on
     * one fails, and the run said so only after the person had already waited for it. Reported at
     * boot and after every connection change with the WHOLE broken set: a connection reconnected,
     * fixed or removed is swept, because nothing else would ever settle its row.
     */
    async signInsRemoved(
      userId: string,
      broken: readonly { connectionId: string; label: string }[],
    ): Promise<void> {
      for (const { connectionId, label } of broken)
        conditions.raise(userId, {
          subject: [REMOVED_SIGN_IN, connectionId],
          problem: 'sign-in-removed',
          severity: 'error',
          title: `${label} needs an API key`,
          body: 'Localix no longer signs in to this provider with an account. Runs on this connection fail until it is connected again with an API key.',
          origin: { kind: 'application', label },
          actions: [recoveryAction('open-settings:providers')],
        })
      const open = new Set(broken.map((entry) => entry.connectionId))
      await conditions.sweep(userId, [REMOVED_SIGN_IN], ([connectionId]) =>
        Boolean(connectionId && open.has(connectionId)),
      )
    },
    /** The connection was deleted: nothing about it is left to fix. */
    connectionRemoved(userId: string, connectionId: string): void {
      conditions.clear(userId, ['provider', connectionId], 'cancelled')
      conditions.clear(userId, [REMOVED_SIGN_IN, connectionId], 'cancelled')
    },
    /** Settle the rows of every connection not in `live` (a deletion missed while down). */
    async connectionsRemaining(userId: string, live: ReadonlySet<string>): Promise<void> {
      for (const prefix of ['provider', REMOVED_SIGN_IN])
        await conditions.sweep(userId, [prefix], ([id]) => Boolean(id && live.has(id)), 'cancelled')
    },
    credentialRefreshed(event: ProviderCredentialEvent): void {
      const subject = ['provider', event.connectionId]
      if (event.ok) return conditions.clear(event.userId, subject)
      conditions.raise(event.userId, {
        subject,
        // One problem per connection: a refresh fails with a different message every time.
        problem: 'sign-in-expired',
        severity: 'error',
        title: `Could not renew the sign-in for ${event.label}`,
        body: [
          'Requests on this connection fail until it renews. If this keeps happening, sign in again.',
          event.error,
        ]
          .filter(Boolean)
          .join('\n'),
        origin: { kind: 'application', label: event.label },
        actions: [recoveryAction(`sign-in:${event.connectionId}`)],
      })
    },
  }
}

export type ProviderConditions = ReturnType<typeof createProviderConditions>

/**
 * Why a refresh threw, unwrapped through `cause`; null when it was only cancelled or timed out —
 * a stopped run or a slow network is not a sign-in that stopped working.
 */
export function refreshFailureReason(error: unknown): string | null {
  const messages: string[] = []
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    if (current instanceof Error) {
      if (current.name === 'AbortError' || current.name === 'TimeoutError') return null
      messages.push(current.message)
      current = current.cause
    } else {
      messages.push(errorMessage(current))
      break
    }
  }
  return messages.join(': ') || 'the refresh failed'
}
