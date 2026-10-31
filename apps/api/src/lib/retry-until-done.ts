import { backoffMs } from '@localixai/agent/backoff'

/** After five minutes, then twice as long each time, at most every six hours. */
const RETRY = { baseMs: 5 * 60_000, maxMs: 6 * 60 * 60 * 1000 }

/**
 * A background pass that runs until it reports `done` — the recommended plugins and mini apps a
 * new installation gets. Offline or failed, it tries again on the backoff above until the signal
 * aborts; a failure is reported to `onError` and counts as `retry`. Returns the first attempt.
 */
export function retryUntilDone(options: {
  run: () => Promise<'done' | 'retry'>
  onError: (error: unknown) => void
  signal: AbortSignal
  /** Test seam: the timer a retry waits on. */
  schedule?: (fn: () => void, ms: number) => void
}): () => Promise<void> {
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms).unref?.())
  let attempt = 0
  const attemptOnce = async (): Promise<void> => {
    const outcome = await options.run().catch((error: unknown) => {
      options.onError(error)
      return 'retry' as const
    })
    if (outcome === 'done' || options.signal.aborted) return
    schedule(() => void attemptOnce(), backoffMs(attempt++, RETRY))
  }
  return attemptOnce
}
