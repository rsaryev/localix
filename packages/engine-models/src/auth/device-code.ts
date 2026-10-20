/**
 * Polling a device-code sign-in (RFC 8628) until the person confirms the code in a browser.
 *
 * Ported from pi (github.com/earendil-works/pi, MIT, © Mario Zechner).
 */
const MINIMUM_INTERVAL_MS = 1_000
/** RFC 8628 §3.2: five seconds when the server names no interval. */
const DEFAULT_INTERVAL_SECONDS = 5
/** RFC 8628 §3.5: `slow_down` adds five seconds. */
const SLOW_DOWN_STEP_MS = 5_000

export type DevicePoll<T> =
  | { status: 'pending' }
  | { status: 'slow_down'; intervalSeconds?: number }
  | { status: 'failed'; message: string }
  | { status: 'complete'; value: T }

export function cancellableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Login cancelled'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Login cancelled'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pollDeviceCode<T>(options: {
  intervalSeconds?: number
  expiresInSeconds?: number
  waitBeforeFirstPoll?: boolean
  signal: AbortSignal | undefined
  poll: () => Promise<DevicePoll<T>>
}): Promise<T> {
  const deadline =
    options.expiresInSeconds !== undefined
      ? Date.now() + options.expiresInSeconds * 1_000
      : Infinity
  let intervalMs = Math.max(
    MINIMUM_INTERVAL_MS,
    Math.floor((options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1_000),
  )
  let slowDowns = 0
  if (options.waitBeforeFirstPoll)
    await cancellableSleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())), options.signal)
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('Login cancelled')
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- polling is sequential by definition
    const result = await options.poll()
    if (result.status === 'complete') return result.value
    if (result.status === 'failed') throw new Error(result.message)
    if (result.status === 'slow_down') {
      slowDowns += 1
      // The server's own figure when it gives one: under a drifting VM clock a tracked one polls early forever.
      intervalMs =
        result.intervalSeconds && Number.isFinite(result.intervalSeconds)
          ? Math.max(MINIMUM_INTERVAL_MS, Math.floor(result.intervalSeconds * 1_000))
          : intervalMs + SLOW_DOWN_STEP_MS
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- polling is sequential by definition
    await cancellableSleep(Math.min(intervalMs, remaining), options.signal)
  }
  throw new Error(
    slowDowns > 0
      ? 'Device sign-in timed out after the server asked to slow down. This is often clock drift in WSL or a VM; sync the clock and try again.'
      : 'Device sign-in timed out',
  )
}
