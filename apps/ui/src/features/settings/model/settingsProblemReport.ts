import { errorDetail, failureSentence } from '@/shared/api/internal'
import { tauriFrontendLog } from '@/shared/lib/tauri'
import { toast } from '@/shared/lib/notify'

/**
 * WHAT THE PERSON IS TOLD when their settings stop reaching the server — the standing condition,
 * separate from the store that produces it.
 *
 * A save or a profile read that keeps failing is a STANDING CONDITION, not an event. Both retry
 * with backoff and, until this existed, said nothing while they did: the only trace of a setting
 * that never landed was a `console.warn` and a `syncError` field no surface renders. A person
 * could change a setting, watch the toggle move, and lose it on the next load with nothing to
 * have read.
 *
 * Two rules live here, and they are the whole reason this is a module rather than four calls
 * inlined at the failure sites:
 *
 *   - NOTHING IS SAID ON THE FIRST FAILURE. A single blip is the common case and the retry fixes
 *     it within a second; a webview that starts before the sidecar loses the first profile read
 *     routinely. The row is published from the SECOND consecutive failure.
 *   - THE ROW IS SETTLED WHEN THE CONDITION ENDS, and only if it was ever published — otherwise a
 *     first-try success would clear a row belonging to the other half of the sync.
 *
 * Both halves publish under ONE scope and ONE subject on purpose: "your settings are out of sync"
 * is a single condition however it is detected, and two publishers of one subject settle each
 * other's rows. The counters are per-reporter instance so a store's report is its own.
 */

/** Where the Event Center keeps "your settings are not reaching the server". */
const SETTINGS_PROBLEM_SCOPE = 'settings'
const SETTINGS_SUBJECT = { subject: { label: 'Settings' } } as const

/** The exact text, for the log and for `detail`. Never for a line a person reads. */
export function rawErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const THRESHOLD = 2

function publish(error: unknown, message: string, hint: string): void {
  toast.problems(
    {
      ...SETTINGS_SUBJECT,
      problems: [
        {
          message: failureSentence(error, message),
          hint,
          detail: errorDetail(error) ?? rawErrorText(error),
        },
      ],
      consequence: 'stale',
    },
    { scope: SETTINGS_PROBLEM_SCOPE },
  )
}

export function createSettingsProblemReport() {
  let saveFailures = 0
  let syncFailures = 0
  const settle = () => toast.problemsCleared(SETTINGS_SUBJECT, SETTINGS_PROBLEM_SCOPE)

  return {
    /** A profile write failed. Silent on the first; a standing row from the second. */
    saveFailed(error: unknown): void {
      if (++saveFailures < THRESHOLD) return
      publish(
        error,
        'Your settings are not reaching the server.',
        'They are kept locally and retried; leaving now may lose the change.',
      )
    },
    /** A profile write landed: settle whatever the centre still says about it. */
    saveRecovered(): void {
      if (saveFailures >= THRESHOLD) settle()
      saveFailures = 0
    },
    /**
     * The bootstrap profile read failed. The bootstrapper retries forever and the app runs on
     * locally cached settings meanwhile — the same standing condition, from the other side.
     */
    syncFailed(error: unknown): void {
      const message = rawErrorText(error)
      console.warn('[settings.bootstrap] profile sync failed; retrying', error)
      // Packaged WKWebView has no readily accessible console. Mirror this narrow startup
      // diagnostic into the shell log so `~/.localix/logs/desktop.log` explains a failure.
      tauriFrontendLog('settings.bootstrap', message)
      if (++syncFailures < THRESHOLD) return
      publish(
        error,
        'Your settings could not be read from the server.',
        'The app is running on the last settings it saw here.',
      )
    },
    /** The profile read landed: settle whatever the centre still says about it. */
    syncRecovered(): void {
      if (syncFailures >= THRESHOLD) settle()
      syncFailures = 0
    },
  }
}
