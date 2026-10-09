import { CORRELATE_ATTEMPT_DELAYS_MS } from './correlate'

interface CorrelationAttempt {
  attempt: number
  timers: () => Set<ReturnType<typeof setTimeout>>
  correlate: () => Promise<boolean>
  retry: () => void
}

/** Track one delayed attempt; retire its timer before trying or scheduling another. */
export function scheduleCorrelationAttempt(options: CorrelationAttempt): void {
  const { attempt, timers, correlate, retry } = options
  if (attempt >= CORRELATE_ATTEMPT_DELAYS_MS.length) return
  const timer = setTimeout(() => {
    timers().delete(timer)
    void correlate().then((adopted) => {
      if (!adopted) retry()
    })
  }, CORRELATE_ATTEMPT_DELAYS_MS[attempt])
  timers().add(timer)
}
