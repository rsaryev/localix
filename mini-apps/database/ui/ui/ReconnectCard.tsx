import { Database } from 'lucide-react'
import { ProblemLine, type MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { StateNotice } from '@localixai/kit/state-notice'
import type { DbConnectionInfo } from '../dbClient'
import { DIALECT_LABEL } from '../model/dialects'
import { useDbProblem } from '../problems'

/**
 * Ownership of the failed attempt is a HOOK the PARENT calls, because this card exists only while
 * the connection is down: a successful reconnect replaces it with the schema browser, so a report
 * owned here would be unmounted at the exact moment it became untrue and its Event Center row
 * would stand forever. The parent stays mounted across both states and settles it by passing
 * `null`.
 */
export function useReconnectProblem(
  connection: DbConnectionInfo | null,
  connecting: boolean,
  error: Problem | undefined,
  onRetry: () => void,
  onRemove: () => void,
): MiniAppProblemLineProps | null {
  return useDbProblem(connection?.name ?? '', connection && !connecting ? error : null, {
    actions: [
      { id: 'retry', label: 'Retry', run: onRetry },
      // Deleting a saved connection is not recovery, and a stale notification row is the last
      // place it should be reachable from.
      { id: 'remove', label: 'Remove', run: onRemove, durable: false },
    ],
  })
}

/** Body shown for a saved-but-disconnected connection. Auto-reconnect is driven by the
 *  parent (on select / click / drop): while it runs we show a quiet "Connecting…" state,
 *  and only a FAILED attempt surfaces the error with an explicit Retry / Remove pair.
 *
 *  A pane-level state, so it is the host's `StateNotice` — centred in the pane, the status as
 *  its title and the failure as a `ProblemLine` in its body. It was a hand-built card pinned to
 *  the top of the pane, beside a "Connection unavailable" state in the same explorer that
 *  already used `StateNotice`: two looks for one kind of state. */
export function ReconnectCard({
  connection,
  error,
  problem,
}: {
  connection: DbConnectionInfo
  /** The failed attempt, when there was one — read here only as "this is not still connecting". */
  error?: Problem
  /** The failed attempt, owned above — see {@link useReconnectProblem}. */
  problem: MiniAppProblemLineProps | null
}) {
  return (
    <StateNotice
      icon={Database}
      title={error ? 'Disconnected' : 'Connecting'}
      role={problem ? 'alert' : 'status'}
      bodyClassName="max-w-sm"
      body={
        <>
          <span className="block truncate">
            {connection.name} · {DIALECT_LABEL[connection.dialect]}
          </span>
          {problem ? (
            <ProblemLine {...problem} className="mt-2 items-center" />
          ) : (
            // Also the transient gap before the auto-reconnect effect fires — read as connecting.
            <ActivitySignal
              label="Reconnecting"
              className="mt-2 justify-center text-2xs text-text-soft"
              labelClassName="min-w-0"
            />
          )}
        </>
      }
    />
  )
}
