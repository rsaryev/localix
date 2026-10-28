import { backoffMs } from '@localixai/agent/backoff'

/** A failed delivery waits from a second, doubling to a minute, shortened at random by up to 20%. */
export const changeRetryDelayMs = (attempt: number): number =>
  backoffMs(attempt, { baseMs: 1000, maxMs: 60_000, jitter: 0.2 })
