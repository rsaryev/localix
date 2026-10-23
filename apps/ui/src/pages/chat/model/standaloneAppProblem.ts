import { toast } from '@/shared/lib/notify'
import type { StandaloneAppContext } from '@/shared/lib/standaloneApp'

/**
 * "This app's mini app is turned off", as ONE standing condition.
 *
 * A turned-off or removed mini app leaves its app with only its chat, and the app is opened again
 * and again while that lasts. A `toast.warning` would write a fresh Event Center row on every
 * launch; a problem keyed to the app coalesces into one row and settles itself the moment the
 * mini app is back.
 */
const SCOPE = 'standalone-apps'
const subjectOf = (app: StandaloneAppContext) => ({ subject: { label: app.name } }) as const

export function reportStandaloneAppUnavailable(app: StandaloneAppContext): void {
  toast.problems(
    {
      ...subjectOf(app),
      title: `${app.name} is turned off in Localix`,
      problems: [
        {
          severity: 'warning',
          message: 'The app shows its conversations, but not the mini app itself.',
          hint: 'Turn the mini app on in Localix to use this app.',
        },
      ],
      consequence: 'stale',
    },
    { scope: SCOPE },
  )
}

export function reportStandaloneAppAvailable(app: StandaloneAppContext): void {
  toast.problemsCleared(subjectOf(app), SCOPE)
}
