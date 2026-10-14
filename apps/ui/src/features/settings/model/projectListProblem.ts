import { errorDetail, failureSentence } from '@/shared/api/internal'
import { toast } from '@/shared/lib/notify'

/**
 * "The project list did not load", as ONE standing condition.
 *
 * The settings panel and the diagnostics tab each read the project list whenever they become
 * visible, and each used to publish its own `toast.error` on failure — so a sidecar that stayed
 * down wrote a fresh, identical row into the Event Center on every tab switch. It is one fact
 * however many readers notice it, so both publish under one scope and one subject: a repeat
 * coalesces into the live row, and whichever reader succeeds next settles it.
 */

const SCOPE = 'settings'
const SUBJECT = { subject: { label: 'Project list' } } as const
const TITLE = 'Could not load the project list'

/** Whether a row is standing, so a routine successful read does not touch the journal at all. */
let standing = false

export function reportProjectListFailure(error: unknown): void {
  standing = true
  toast.problems(
    {
      ...SUBJECT,
      title: TITLE,
      problems: [
        {
          message: failureSentence(error, 'The server did not answer with the project list.'),
          hint: 'Project settings stay unavailable until the list loads; reopen this tab to retry.',
          detail: errorDetail(error),
        },
      ],
      consequence: 'stale',
    },
    { scope: SCOPE },
  )
}

export function reportProjectListLoaded(): void {
  if (!standing) return
  standing = false
  toast.problemsCleared(SUBJECT, SCOPE)
}
