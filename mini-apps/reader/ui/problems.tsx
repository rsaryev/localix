/**
 * A reader failure, said the way every other Localix failure is said.
 *
 * A book that will not open is the one failure a reader cannot hide: the pane is empty and the
 * person is left holding a file. What it must not also be is invisible five seconds later, so the
 * same sentence goes to the Event Center as goes on the pane.
 *
 * Ownership of a standing report belongs to the SDK; what is left here is this mini app's scope and
 * the fact that a reader's subject is a file, which the centre can name and open.
 */

import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import type {
  ProblemConsequence,
  ProblemRecovery,
  ProblemSubject,
} from '@localixai/mini-app-sdk/ui/problems'

/** Namespace for this mini app's rows in the Event Center. */
export const READER_PROBLEM_SCOPE = 'reader'

export interface ReaderProblemOptions {
  /** Overrides the headline. Omit it: one problem's own message is the honest headline. */
  title?: string
  /** The raw text a parser produced. Event Center only, never on the pane. */
  detail?: string | null
  consequence?: ProblemConsequence
  actions?: readonly ProblemRecovery[]
}

/**
 * Publish `message` about `subject` for as long as it stands, and return exactly what the surface
 * renders: `{problem && <ProblemLine {...problem} />}`. Null when there is nothing wrong.
 */
export function useReaderProblem(
  subject: ProblemSubject,
  message: string | null | undefined,
  options: ReaderProblemOptions = {},
): MiniAppProblemLineProps | null {
  const { title, detail, consequence = 'blocked', actions } = options
  const owned = useProblemReport(
    message
      ? { subject, problems: [{ message, detail: detail ?? undefined }], consequence, title }
      : null,
    { scope: READER_PROBLEM_SCOPE, sourceVisible: true, actions },
  )
  return owned
}
