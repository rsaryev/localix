/**
 * A failed read, said the way every other Localix failure is said.
 *
 * The dashboard wrote each failure as a hand-made `<p role="alert">` in a warning colour: three
 * copies with their own wording, gone the moment the next poll succeeded, never in the Event
 * Center where a person could read it afterwards. A copied plugin inherits whatever this file
 * does, so it reports through the host's `ProblemLine` contract instead.
 *
 * A hook, not a component: the surfaces decide what to draw with early branches, and a publisher
 * living inside the failing branch would unmount exactly when the failure ends. Call it above the
 * branches and pass `failure: null` while things work.
 */
import { useMemo } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemConsequence, ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

export function useSystemProblem({
  subject,
  failure,
  consequence,
  title,
}: {
  /** What failed, named the way a person names it. */
  subject: string
  /** The reason, or null while the surface works. */
  failure: string | null
  /** `stale` while the last good sample is still on screen; `blocked` when nothing is. */
  consequence: ProblemConsequence
  title?: string
}): MiniAppProblemLineProps | null {
  const report = useMemo<ProblemReport | null>(
    () =>
      failure
        ? {
            subject: { label: subject },
            problems: [{ message: failure }],
            consequence,
            ...(title ? { title } : {}),
          }
        : null,
    [subject, failure, consequence, title],
  )
  return useProblemReport(report, { scope: 'template', sourceVisible: true })
}
