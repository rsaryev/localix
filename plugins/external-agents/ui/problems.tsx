/**
 * An external-agent failure, said the way every other Localix failure is said.
 *
 * The roster reads other people's tools off disk, so it fails for reasons that are not ours — a
 * provider that moved its state directory, a stats file half-written. Those reasons used to live in
 * the pane that could not render, which is the one place a person stops looking once it is empty.
 *
 * A hook rather than a component because each of these surfaces decides what to show with an early
 * `return`, and a publisher that only exists inside the failing branch is unmounted exactly when
 * the failure ends — which is when the Event Center needs to hear about it.
 */

import { useMemo, type ReactNode } from 'react'
import { useProblemReport } from '@localixai/plugin-sdk/ui'
import { ProblemLine, ProblemState } from '@localixai/plugin-sdk/ui/components'
import type { ProblemReport } from '@localixai/plugin-sdk/ui/problems'

/** Namespace for this plugin's rows in the Event Center. */
const SCOPE = 'external-agents'

/** The line to render, or null when there is nothing wrong. */
export function useExternalAgentsProblem({
  subject,
  message,
  detail,
  onRetry,
  centered = false,
}: {
  /** Short human name for what failed — the roster, the statistics, the provider list. */
  subject: string
  message: string | null | undefined
  /** The raw text the provider's own files produced. Event Center only, never on the line. */
  detail?: string | null
  onRetry?: () => void
  /** Sole content of a pane: centre in the space instead of sitting in the flow. */
  centered?: boolean
}): ReactNode | null {
  const report = useMemo<ProblemReport | null>(
    () =>
      message
        ? {
            subject: { label: subject },
            problems: [{ severity: 'error', message, detail: detail ?? undefined }],
            consequence: centered ? 'blocked' : 'stale',
          }
        : null,
    [subject, message, detail, centered],
  )
  const problem = useProblemReport(report, {
    scope: SCOPE,
    sourceVisible: true,
    actions: onRetry ? [{ id: 'retry', label: 'Retry', run: onRetry }] : undefined,
  })
  if (!problem) return null
  // The pane shape is the host's: a hand-built `flex-1` centre is a no-op in a block parent.
  return centered ? <ProblemState {...problem} /> : <ProblemLine {...problem} />
}
