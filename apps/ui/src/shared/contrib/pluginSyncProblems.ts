import { errorDetail, failureSentence } from '@/shared/api/internal'
import { toast } from '@/shared/lib/notify'
import { tauriFrontendLog } from '@/shared/lib/tauri'

/**
 * How a failing plugin-contribution sync is reported, and its recovery — split out of
 * `enabledPlugins.ts`, which owns the sync itself. One place counts the consecutive failures, so
 * the log line, the Event Center condition and its clearing agree on one outage.
 */

let consecutiveFailures = 0

/** Where the Event Center keeps "the plugins are not loading". */
const PLUGINS_PROBLEM_SCOPE = 'plugins'
const PLUGINS_SUBJECT = { subject: { label: 'Plugins' } } as const

export function reportPluginSyncFailure(error: unknown): void {
  // One line per outage, not one line per retry. A long unavailable sidecar should
  // remain diagnosable without filling the packaged shell log every ten seconds.
  const raw = error instanceof Error ? error.message : String(error)
  if (consecutiveFailures === 0) {
    console.warn('[plugins.bootstrap] contribution sync failed; retrying', error)
    tauriFrontendLog('plugins.bootstrap', `failed: ${raw}`)
  }
  consecutiveFailures += 1
  // A standing condition, and one with a VISIBLE consequence: this fails closed, so every
  // contributed view, tool and tab stays hidden while it retries. The log said so; the person
  // looking at a workbench with no plugins in it was told nothing. Second failure onwards, so a
  // webview that starts before the sidecar does not report a race it recovers from.
  if (consecutiveFailures < 2) return
  toast.problems(
    {
      ...PLUGINS_SUBJECT,
      problems: [
        {
          message: failureSentence(error, 'The installed plugins could not be loaded.'),
          hint: 'Plugin views and tools stay hidden until this succeeds.',
          detail: errorDetail(error) ?? raw,
        },
      ],
      consequence: 'blocked',
    },
    { scope: PLUGINS_PROBLEM_SCOPE },
  )
}

export function reportPluginSyncRecovery(): void {
  if (consecutiveFailures === 0) return
  console.info(
    `[plugins.bootstrap] contribution sync recovered after ${consecutiveFailures} failure(s)`,
  )
  tauriFrontendLog('plugins.bootstrap', `recovered failures=${consecutiveFailures}`)
  if (consecutiveFailures >= 2) toast.problemsCleared(PLUGINS_SUBJECT, PLUGINS_PROBLEM_SCOPE)
  consecutiveFailures = 0
}

/** Test seam: forget the outage in progress. */
export function __resetPluginSyncProblems(): void {
  consecutiveFailures = 0
}
