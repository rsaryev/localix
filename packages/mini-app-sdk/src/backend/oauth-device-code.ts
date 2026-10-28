import { sleep } from '@localixai/agent/backoff'

/**
 * RFC 8628 device-code polling loop.
 * Provider-agnostic: the caller supplies a `poll()` that hits the provider's token
 * endpoint and maps the response to a status.
 */

const MINIMUM_INTERVAL_MS = 1000
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000
/**
 * Hard fallback cap on the whole device-flow poll when the provider did NOT hand us
 * a finite `expiresInSeconds`. RFC 8628 device codes are short-lived; GitHub — the one
 * device-code provider bundled here — issues codes with `expires_in: 900`, so 900s is the
 * real-world lifetime, not a guess. Without this, an ABSENT lifetime made the deadline
 * `Infinity` and the poll loop (plus its `throw 'Device flow timed out'`) unreachable —
 * an unbounded wait on an integration point.
 */
const DEFAULT_EXPIRY_CAP_SECONDS = 900

export type DeviceCodePollResult<T> =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'failed'; message: string }
  | { status: 'complete'; value: T }

export interface DeviceCodePollOptions<T> {
  intervalSeconds?: number
  expiresInSeconds?: number
  /**
   * Poll the provider. The signal aborts at the overall device-flow deadline or
   * when the caller's signal aborts. Callbacks that take no arguments remain
   * assignable; signal-aware callbacks can also cancel their underlying fetch.
   */
  poll: (signal: AbortSignal) => Promise<DeviceCodePollResult<T>>
  signal?: AbortSignal
  /** Clock seam (injected in tests to drive the deadline without real sleeps). Defaults to Date.now. */
  now?: () => number
}

export async function pollDeviceCode<T>(options: DeviceCodePollOptions<T>): Promise<T> {
  const now = options.now ?? Date.now
  // A finite lifetime is used verbatim (0/past values keep their existing meaning:
  // an immediate timeout). Only a non-finite lifetime — ABSENT, NaN, or Infinity —
  // falls back to the cap, so the deadline can NEVER be Infinity and the poll is
  // always bounded.
  const expirySeconds = Number.isFinite(options.expiresInSeconds)
    ? (options.expiresInSeconds as number)
    : DEFAULT_EXPIRY_CAP_SECONDS
  const expiryMs = expirySeconds * 1000
  const deadline = now() + expiryMs
  let intervalMs = Math.max(
    MINIMUM_INTERVAL_MS,
    Math.floor((options.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
  )

  const controller = new AbortController()
  let rejectStop!: (error: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStop = reject
  })
  // This promise intentionally outlives whichever in-flight operation loses the
  // race. Mark it handled independently so cleanup after an early success can
  // never turn a later deadline/cancel into an unhandled rejection.
  void stopped.catch(() => {})
  let stopError: Error | null = null
  const stop = (error: Error) => {
    if (stopError) return
    stopError = error
    // Reject the public race first so a signal-aware provider that rejects
    // synchronously from its abort listener cannot replace our stable timeout /
    // cancellation error with its transport-specific AbortError.
    rejectStop(error)
    controller.abort(error)
  }
  const onAbort = () => stop(new Error('Device flow cancelled'))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  const deadlineTimer = setTimeout(
    () => stop(new Error('Device flow timed out')),
    Math.max(0, expiryMs),
  )

  try {
    while (now() < deadline) {
      if (stopError) throw stopError

      // `stopped` is the overall deadline/cancellation gate. Promise.race installs
      // handlers on the provider promise, so a callback that ignores the signal
      // and rejects late cannot produce an unhandled rejection or restart polling.
      const result = await Promise.race([options.poll(controller.signal), stopped])
      if (result.status === 'complete') return result.value
      if (result.status === 'failed') throw new Error(result.message)
      if (result.status === 'slow_down')
        intervalMs = Math.max(MINIMUM_INTERVAL_MS, intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_MS)

      const remainingMs = deadline - now()
      if (remainingMs <= 0) break
      await Promise.race([sleep(Math.min(intervalMs, remainingMs), controller.signal), stopped])
    }

    throw new Error('Device flow timed out')
  } finally {
    clearTimeout(deadlineTimer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
