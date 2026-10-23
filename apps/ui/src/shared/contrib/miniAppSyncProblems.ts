import { errorDetail, failureSentence } from '@/shared/api/internal'
import { toast } from '@/shared/lib/notify'
import { tauriFrontendLog } from '@/shared/lib/tauri'

/**
 * How a failing mini-app-contribution sync is reported, and its recovery — split out of
 * `enabledMiniApps.ts`, which owns the sync itself. One place counts the consecutive failures, so
 * the log line, the Event Center condition and its clearing agree on one outage.
 */

let consecutiveFailures = 0

/** Where the Event Center keeps "the mini apps are not loading". */
const MINI_APPS_PROBLEM_SCOPE = 'mini-apps'
const MINI_APPS_SUBJECT = { subject: { label: 'Mini apps' } } as const

export function reportMiniAppSyncFailure(error: unknown): void {
  // One line per outage, not one line per retry. A long unavailable sidecar should
  // remain diagnosable without filling the packaged shell log every ten seconds.
  const raw = error instanceof Error ? error.message : String(error)
  if (consecutiveFailures === 0) {
    console.warn('[mini-apps.bootstrap] contribution sync failed; retrying', error)
    tauriFrontendLog('mini-apps.bootstrap', `failed: ${raw}`)
  }
  consecutiveFailures += 1
  // A standing condition, and one with a VISIBLE consequence: this fails closed, so every
  // contributed view, tool and tab stays hidden while it retries. The log said so; the person
  // looking at a workbench with no mini apps in it was told nothing. Second failure onwards, so a
  // webview that starts before the sidecar does not report a race it recovers from.
  if (consecutiveFailures < 2) return
  toast.problems(
    {
      ...MINI_APPS_SUBJECT,
      problems: [
        {
          message: failureSentence(error, 'The installed mini apps could not be loaded.'),
          hint: 'Mini app views and tools stay hidden until this succeeds.',
          detail: errorDetail(error) ?? raw,
        },
      ],
      consequence: 'blocked',
    },
    { scope: MINI_APPS_PROBLEM_SCOPE },
  )
}

export function reportMiniAppSyncRecovery(): void {
  if (consecutiveFailures === 0) return
  console.info(
    `[mini-apps.bootstrap] contribution sync recovered after ${consecutiveFailures} failure(s)`,
  )
  tauriFrontendLog('mini-apps.bootstrap', `recovered failures=${consecutiveFailures}`)
  if (consecutiveFailures >= 2) toast.problemsCleared(MINI_APPS_SUBJECT, MINI_APPS_PROBLEM_SCOPE)
  consecutiveFailures = 0
}

/** Test seam: forget the outage in progress. */
export function __resetMiniAppSyncProblems(): void {
  consecutiveFailures = 0
}
