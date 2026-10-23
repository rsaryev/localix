/**
 * A trading failure, said the way every other Localix failure is said.
 *
 * A venue that stops answering is the normal weather here, so this mini app grew a habit of writing
 * the reason into an `EmptyHint` — grey text in the middle of a pane, gone the moment the next
 * poll succeeded, and never anywhere a person could find it afterwards. A market you were not
 * watching is exactly the one whose failure you need to read later.
 *
 * A hook, not a component: every one of these surfaces decides what to draw with an early `return`,
 * and a publisher that lives only inside the failing arm is unmounted precisely when the failure
 * ends. Call it above the branches and pass `failure: null` while things work.
 */

import { useMemo } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemConsequence, ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

/** Namespace for this mini app's rows in the Event Center. */
const SCOPE = 'trading'

export interface TradingFailure {
  message: string
  /** What the venue actually said — usually a JSON body. Event Center only. */
  detail?: string
}

export function useTradingProblem({
  subject,
  failure,
  consequence = 'blocked',
  title,
  onRetry,
}: {
  /** What failed, named the way a person names it: a market, a venue, a panel. */
  subject: string
  failure: TradingFailure | null | undefined
  consequence?: ProblemConsequence
  /** Overrides the headline when the surface knows a better sentence than the venue's. */
  title?: string
  onRetry?: () => void
}): MiniAppProblemLineProps | null {
  const report = useMemo<ProblemReport | null>(
    () =>
      failure
        ? {
            subject: { label: subject },
            problems: [{ message: failure.message, detail: failure.detail }],
            consequence,
            title,
          }
        : null,
    [subject, failure, consequence, title],
  )
  return useProblemReport(report, {
    scope: SCOPE,
    sourceVisible: true,
    actions: onRetry ? [{ id: 'retry', label: 'Retry', run: onRetry }] : undefined,
  })
}
