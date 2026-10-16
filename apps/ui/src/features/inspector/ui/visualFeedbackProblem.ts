import { toast } from '@/shared/lib/notify'

/**
 * A visual-feedback probe error as ONE standing row, not one row per message.
 *
 * The probe reports from inside the preview's page, and a broken page reports the same failure on
 * every click — each used to land as a fresh `toast.error`, burying the journal. Under a stable
 * subject a repeat coalesces into the live row and a different failure supersedes it. The text is
 * `postMessage` data from another realm, typed but never checked, so it is coerced before it is
 * shown: a non-string would otherwise print as `[object Object]` or throw in the renderer.
 */
const PROBE_SCOPE = 'inspector.visual-feedback'
const PROBE_SUBJECT = { subject: { label: 'Visual feedback' } } as const

function probeProblemText(message: unknown): string {
  const text = typeof message === 'string' ? message.trim() : ''
  return text || 'The probe did not say what went wrong.'
}

export function reportProbeProblem(message: unknown): void {
  toast.problems(
    {
      ...PROBE_SUBJECT,
      // `Visual feedback: <probe text>` put the probe's own words in the headline; they are a
      // developer's sentence, not a reader's, so they stay in the body.
      title: 'Visual feedback reported a problem in the preview',
      problems: [{ message: probeProblemText(message) }],
      consequence: 'none',
    },
    { scope: PROBE_SCOPE },
  )
}

/** A reloaded page is a fresh probe: whatever the old page reported is gone with it. */
export function clearProbeProblem(): void {
  toast.problemsCleared(PROBE_SUBJECT, PROBE_SCOPE)
}
