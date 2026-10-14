import {
  startStartupRetry,
  startupRetryDelay,
  scheduleStartupRetry,
  cancelStartupRetry,
  type StartupRetryCancel,
  type StartupRetrySchedule,
} from '@/shared/lib/startupRetry'

export function settingsSyncRetryDelay(failureIndex: number): number {
  return startupRetryDelay(failureIndex)
}

/**
 * Keep the authoritative user profile converging in the background.
 *
 * The packaged desktop API is a freshly spawned sidecar. Its first TCP listen happens
 * after the webview can render, so a one-shot GET has a routine startup race. Returning
 * a cleanup function makes the loop safe under React StrictMode and route teardown.
 */
export function startSettingsBootstrap(
  load: () => Promise<boolean>,
  schedule: StartupRetrySchedule = scheduleStartupRetry,
  cancel: StartupRetryCancel = cancelStartupRetry,
): () => void {
  return startStartupRetry(load, schedule, cancel)
}
