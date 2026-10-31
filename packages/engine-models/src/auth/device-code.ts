/**
 * Polling a device-code sign-in (RFC 8628) until the person confirms the code in a browser.
 */
import { sleep } from '@localixai/agent/backoff'

const FLOOR_MS = 1_000
/** RFC 8628 §3.2: five seconds when the server names no interval. */
const DEFAULT_INTERVAL_MS = 5_000
/** RFC 8628 §3.5: `slow_down` adds five seconds. */
const SLOW_DOWN_MS = 5_000

const CANCELLED = 'Login cancelled'

type DevicePoll<T> =
  | { status: 'pending' }
  | { status: 'slow_down'; intervalSeconds?: number }
  | { status: 'failed'; message: string }
  | { status: 'complete'; value: T }

/** Wait `ms`; a cancelled sign-in rejects as cancelled, before the wait or during it. */
export async function cancellableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw new Error(CANCELLED)
  await sleep(ms, signal)
  if (signal?.aborted) throw new Error(CANCELLED)
}

const secondsToMs = (seconds: number) => Math.max(FLOOR_MS, Math.floor(seconds * 1_000))

export async function pollDeviceCode<T>(options: {
  intervalSeconds?: number
  expiresInSeconds?: number
  waitBeforeFirstPoll?: boolean
  signal: AbortSignal | undefined
  poll: () => Promise<DevicePoll<T>>
}): Promise<T> {
  const { signal } = options
  const expiresAt =
    options.expiresInSeconds === undefined
      ? Number.POSITIVE_INFINITY
      : Date.now() + options.expiresInSeconds * 1_000
  const timeLeft = () => expiresAt - Date.now()
  let waitMs =
    options.intervalSeconds === undefined
      ? DEFAULT_INTERVAL_MS
      : secondsToMs(options.intervalSeconds)
  let askedToSlowDown = false

  if (options.waitBeforeFirstPoll)
    await cancellableSleep(Math.min(waitMs, Math.max(0, timeLeft())), signal)
  while (timeLeft() > 0) {
    if (signal?.aborted) throw new Error(CANCELLED)
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- polling is sequential by definition
    const answer = await options.poll()
    switch (answer.status) {
      case 'complete':
        return answer.value
      case 'failed':
        throw new Error(answer.message)
      case 'slow_down': {
        askedToSlowDown = true
        // The server's own figure when it gives one: under a drifting VM clock a tracked one polls early forever.
        const named = answer.intervalSeconds
        waitMs = named && Number.isFinite(named) ? secondsToMs(named) : waitMs + SLOW_DOWN_MS
        break
      }
      case 'pending':
        break
    }
    const left = timeLeft()
    if (left <= 0) break
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- polling is sequential by definition
    await cancellableSleep(Math.min(waitMs, left), signal)
  }
  if (askedToSlowDown) {
    throw new Error(
      'Device sign-in timed out after the server asked to slow down. This is often clock drift in WSL or a VM; sync the clock and try again.',
    )
  }
  throw new Error('Device sign-in timed out')
}
