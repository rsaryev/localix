import type { MonitorEndReason } from '../../../monitors/contracts'

/** The bounds of a `bash until` wait; the monitor service enforces the same ones. */
export const MONITOR_DEFAULT_TIMEOUT_MS = 300_000
export const MONITOR_MAX_TIMEOUT_MS = 3_600_000
export const MONITOR_MIN_INTERVAL_SECONDS = 5

/** Human phrase for an end reason — used in the wake text and the tool card. */
export function monitorEndPhrase(reason: MonitorEndReason): string {
  switch (reason) {
    case 'condition-met':
      return 'the condition was met'
    case 'exited':
      return 'the watched command exited'
    case 'timeout':
      return 'it reached its timeout'
    case 'killed':
      return 'it was stopped'
    case 'rate-limited':
      return 'it produced too many events and was stopped'
    case 'error':
      return 'it failed to run'
    case 'restart':
      return 'the server restarted, and the watched command did not survive it'
  }
}
