import type { ReactNode } from 'react'
import { createMessageBindingDraft, runMiniAppAction, toast } from '@localixai/mini-app-sdk/ui'
import { ProblemState } from '@localixai/mini-app-sdk/ui/components'
import { miniAppNavigation } from '@localixai/mini-app-sdk/ui/runtime'

import type { ReaderSource } from '../shared/contracts'
import { readerFileName, readerUnsupportedReason } from '../shared/formats'
import { useReaderProblem } from './problems'

/**
 * The reading pane's failure state — and the reason it is its own module: a failed open used to
 * render a bare notice ABOVE the pane's chrome, so a reader opened on a file it cannot parse had no
 * toolbar, no back button and no way out but closing the tab. Every exit the user could want rides
 * with the report instead, which also puts them in the Event Center for a person who has already
 * left the pane.
 *
 * A hook, not a component: the pane decides what to show with early returns, and a publisher that
 * only exists inside the failing branch is unmounted exactly when the failure ends — so the row it
 * published would stand for a book that opens fine on the retry. Call it above the branches with
 * `message: null` while the file is readable.
 */
export function useReaderOpenFailure({
  sessionId,
  source,
  message,
  detail,
  onBack,
  onRetry,
}: {
  /** The chat the pane belongs to — where "Open outside Reader" opens the file. */
  sessionId: string
  source: ReaderSource
  message: string | null
  /** The parser's own words. Event Center only. */
  detail?: string | null
  /** Return to the library. Always offered — a dead end is never acceptable. */
  onBack?: () => void
  onRetry?: () => void
}): ReactNode | null {
  const name = readerFileName(source)
  const unsupported = readerUnsupportedReason(source) !== null
  const path = 'path' in source ? source.path : null
  // A rejected navigation used to be an unhandled rejection: the button did nothing, silently.
  const openOutside = () => {
    runMiniAppAction(async () => {
      if (
        await miniAppNavigation.openBinding(
          createMessageBindingDraft('file', path!, name),
          sessionId,
        )
      )
        return
      toast.error(`Could not open “${name}” outside Reader`, {
        description: 'Nothing else in the workspace can open this file.',
      })
    }, `Could not open “${name}” outside Reader`)
  }
  const problem = useReaderProblem(
    { label: name || 'this file', path: path ?? undefined },
    message,
    {
      detail,
      // An unsupported format names the file, because ".png is not a reading format" alone does
      // not say WHICH file the pane is refusing.
      title: unsupported ? `Reader cannot open ${name || 'this file'}` : undefined,
      actions: [
        // Leaving for the library only means something on the pane itself.
        ...(onBack ? [{ id: 'back', label: 'Back to library', run: onBack, durable: false }] : []),
        ...(path ? [{ id: 'open-outside', label: 'Open outside Reader', run: openOutside }] : []),
        // A format the reader will never parse cannot be retried into working.
        ...(onRetry && !unsupported ? [{ id: 'retry', label: 'Try again', run: onRetry }] : []),
      ],
    },
  )
  if (!problem) return null
  return <ProblemState {...problem} />
}
