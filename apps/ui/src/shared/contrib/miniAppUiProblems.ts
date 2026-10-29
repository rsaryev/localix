import { errorDetail, failureSentence } from '@/shared/api/internal'
import { toast } from '@/shared/lib/notify'

/**
 * What the person is told when a mini app's UI does not load. The runtime reports each failed
 * attempt here (`miniAppUiDiscovery.ts`); the loads keep retrying on the startup backoff, and only
 * once the budget is spent (`miniAppUiLoads.ts`) is the last error published as a standing
 * problem of that mini app — one row, cleared the moment a later pass loads it. Until then a
 * console line is all a retry leaves, so a sidecar that starts late never raises a row it is about
 * to settle.
 */

type ProblemHost = Pick<typeof toast, 'problems' | 'problemsCleared'>

let host: ProblemHost = toast
const lastError = new Map<string, unknown>()
const reported = new Set<string>()

const scopeOf = (miniAppName: string) => `mini-app-ui:${miniAppName}`
const subjectOf = (miniAppName: string) => ({ subject: { label: miniAppName } }) as const

/** An attempt failed; remembered for the row, logged once per attempt. */
export function rememberMiniAppUiError(miniAppName: string, error: unknown): void {
  lastError.set(miniAppName, error)
  console.warn(
    `[mini-app-ui] "${miniAppName}" could not load its UI; the running version (if any) stays`,
    error,
  )
}

/** Its retry budget is spent: the person sees why, in the Event Center. */
export function reportMiniAppUiFailed(miniAppName: string): void {
  const error = lastError.get(miniAppName)
  reported.add(miniAppName)
  host.problems(
    {
      ...subjectOf(miniAppName),
      problems: [
        {
          message: failureSentence(error, `The "${miniAppName}" mini app could not load its UI.`),
          hint: 'Its screens stay hidden; disable and enable it, or update it, to try again.',
          ...(errorDetail(error) ? { detail: errorDetail(error) } : {}),
        },
      ],
      consequence: 'blocked',
    },
    { scope: scopeOf(miniAppName) },
  )
}

/** It loaded: whatever was said about it is settled. */
export function reportMiniAppUiLoaded(miniAppName: string): void {
  lastError.delete(miniAppName)
  if (!reported.delete(miniAppName)) return
  host.problemsCleared(subjectOf(miniAppName), scopeOf(miniAppName))
}

/** Test seam: where the rows go, and forget what was said. */
export function __setMiniAppUiProblemHost(next: ProblemHost | null): void {
  host = next ?? toast
  lastError.clear()
  reported.clear()
}
