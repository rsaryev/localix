/**
 * A REST client failure, said the way every other Localix failure is said.
 *
 * Four surfaces here each grew their own tinted strip: a send that failed, a save that failed, a
 * folder action that failed, a request list that would not load. All four said their piece in place
 * and nowhere else, so the reason a send failed was gone as soon as the next one succeeded. One
 * line on the surface, the whole report in the Event Center.
 *
 * Render this UNCONDITIONALLY and pass `message={null}` when the thing worked. It draws nothing in
 * that state, and it is the only way the row it published gets settled. Where the line has to be
 * drawn somewhere that unmounts — a dialog — call `useApiProblem` from the surface that owns the
 * state and render its result inside.
 */

import { useMemo, type ReactNode } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import { ProblemLine, ProblemState } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemConsequence, ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

/** Namespace for this mini app's rows in the Event Center. */
const SCOPE = 'api'

export function ApiProblem(props: ApiProblemProps) {
  return useApiProblem(props)
}

export interface ApiProblemProps {
  /** Short human name for what failed — a request name, an environment, the library. */
  subject: string
  message: string | null | undefined
  /** The raw thing the server or the importer said. Event Center only, never on the line. */
  detail?: string | null
  /** Sole content of a pane: centre in the space instead of sitting in the flow. */
  centered?: boolean
  /**
   * What the person is looking at while this stands. Defaults to what the layout implies, which is
   * right for a line that IS the pane and wrong for one sitting above a pane that has never shown
   * anything — "showing the last valid version" over an empty response is a sentence about nothing.
   */
  consequence?: ProblemConsequence
}

/**
 * The hook behind {@link ApiProblem}, for a surface whose LINE is drawn somewhere the owner cannot
 * live — the import dialog, which unmounts on close and would leave its row standing forever.
 * Call it where the state lives; render what it returns wherever the person is looking.
 */
export function useApiProblem({
  subject,
  message,
  detail,
  centered = false,
  consequence,
}: ApiProblemProps): ReactNode | null {
  const report = useMemo<ProblemReport | null>(
    () =>
      message
        ? {
            subject: { label: subject },
            problems: [{ severity: 'error', message, detail: detail ?? undefined }],
            consequence: consequence ?? (centered ? 'blocked' : 'stale'),
          }
        : null,
    [subject, message, detail, centered, consequence],
  )
  const problem = useProblemReport(report, { scope: SCOPE, sourceVisible: true })
  if (!problem) return null
  // The pane shape is the host's: a hand-built `flex-1` centre is a no-op in a block parent.
  if (centered) return <ProblemState {...problem} />
  return <ProblemLine {...problem} className="px-3 py-1.5" />
}
