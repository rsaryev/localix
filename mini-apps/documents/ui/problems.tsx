/**
 * A document that would not open, said the way every other Localix failure is said.
 *
 * Each tab kind had its own centred card carrying the extractor's message, which meant the message
 * only existed while that tab was on screen — close it and the reason the file failed was gone.
 * The pane now says one line and the Event Center keeps the rest.
 *
 * Render this UNCONDITIONALLY and pass `message={null}` when the file opened. It draws nothing in
 * that state, and it is the only way the row it published gets settled.
 */

import { useMemo, type ReactNode } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import { ProblemState } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

/** Namespace for this mini app's rows in the Event Center. */
const SCOPE = 'documents'

/**
 * Nothing rendered: the report is the tab. A hook rather than a component because every tab kind
 * decides what to show with an early `return`, and a publisher that only exists inside the failing
 * branch is unmounted exactly when the failure ends.
 */
export function useDocumentProblem({
  label,
  path,
  message,
  detail,
  onRetry,
}: {
  /** Short human name for the file — what the tab is called. */
  label: string
  path?: string
  message: string | null | undefined
  /** What the extraction library said, verbatim. Event Center only, never on the tab. */
  detail?: string | null
  onRetry?: () => void
}): ReactNode | null {
  const report = useMemo<ProblemReport | null>(
    () =>
      message
        ? {
            subject: { label, path },
            problems: [{ severity: 'error', message, detail: detail ?? undefined }],
            consequence: 'blocked',
          }
        : null,
    [label, path, message, detail],
  )
  const problem = useProblemReport(report, {
    scope: SCOPE,
    sourceVisible: true,
    actions: onRetry ? [{ id: 'retry', label: 'Retry', run: onRetry }] : undefined,
  })
  if (!problem) return null
  // The report IS the tab, so it is the host's pane shape — a hand-built `flex-1` centre is a no-op
  // in a block parent and left the failure at the top of an empty tab.
  return <ProblemState {...problem} />
}
