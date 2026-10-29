import { memo } from 'react'
import { CircleDollarSign } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import { formatCost } from '../../model/usageFormat'
import {
  dismissSpendAlert,
  isSpendAlertVisible,
  spendLevel,
  useDismissedSpendLevel,
  useSpendThreshold,
} from '@/shared/lib/spendAlert'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

/**
 * Composer strip that warns when the session's cumulative *metered* spend crosses
 * a user-set budget (Preferences → Spend alert). Mirrors SleepStrip's compact
 * visual language. Purely client-side: the cost already flows to the store, the
 * threshold is a client preference, and dismissal is ephemeral. Re-appears when
 * spend climbs into a higher multiple of the budget, so a long run keeps warning.
 *
 * Skipped for subscription (OAuth-plan) cost, which is a catalog estimate rather
 * than real money — an alert there would be misleading.
 */
export function SpendAlertRow({
  cost,
  threshold,
  level,
  onDismiss,
}: {
  cost: number
  threshold: number
  level: number
  onDismiss: () => void
}) {
  return (
    <WorkbenchNoticeBar
      role="status"
      tone="warning"
      icon={<CircleDollarSign className="size-3.5" />}
      title="Spend alert"
      description={
        <>
          This session has spent{' '}
          <span className="font-mono text-text-soft">{formatCost(cost)}</span> — past your{' '}
          <span className="font-mono text-text-soft">{formatCost(threshold)}</span> budget
          {level > 1 ? ` (${level}×)` : ''}
        </>
      }
      onDismiss={onDismiss}
      dismissLabel="Dismiss until spend crosses the next budget step"
    />
  )
}

/**
 * Memoized: both props come straight from the store/transcript snapshot, so the
 * spend math runs when spend moves — not when the draft text does.
 */
export const SpendAlertStrip = memo(function SpendAlertStrip({
  sessionId,
  sessionUsage,
}: {
  sessionId: string | null
  sessionUsage?: ChatUsagePayload
}) {
  const threshold = useSpendThreshold()
  const dismissed = useDismissedSpendLevel(sessionId)

  const cost = sessionUsage?.totalCost
  const level = spendLevel(cost, threshold)
  if (
    !sessionId ||
    threshold <= 0 ||
    sessionUsage?.costSource === 'subscription' ||
    !isSpendAlertVisible(level, dismissed)
  ) {
    return null
  }

  return (
    <SpendAlertRow
      cost={cost ?? 0}
      threshold={threshold}
      level={level}
      onDismiss={() => dismissSpendAlert(sessionId, level)}
    />
  )
})
