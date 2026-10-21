import { toast } from '@/shared/lib/notify'
import type { PluginAppContext } from '@/shared/lib/pluginApp'

/**
 * "This app's plugin is turned off", as ONE standing condition.
 *
 * A turned-off or removed plugin leaves its app with only its chat, and the app is opened again
 * and again while that lasts. A `toast.warning` would write a fresh Event Center row on every
 * launch; a problem keyed to the app coalesces into one row and settles itself the moment the
 * plugin is back.
 */
const SCOPE = 'plugin-apps'
const subjectOf = (app: PluginAppContext) => ({ subject: { label: app.name } }) as const

export function reportPluginAppUnavailable(app: PluginAppContext): void {
  toast.problems(
    {
      ...subjectOf(app),
      title: `${app.name} is turned off in Localix`,
      problems: [
        {
          severity: 'warning',
          message: 'The app shows its conversations, but not the plugin itself.',
          hint: 'Turn the plugin on in Localix to use this app.',
        },
      ],
      consequence: 'stale',
    },
    { scope: SCOPE },
  )
}

export function reportPluginAppAvailable(app: PluginAppContext): void {
  toast.problemsCleared(subjectOf(app), SCOPE)
}
