/** The rate shown (and the ETA built on it) covers this much recent work, not the whole run. */
const RATE_WINDOW_MS = 30_000

/** Chunks embedded per second over the recent window: what the status bar shows while indexing. */
export function createIndexRate(now: () => number = Date.now) {
  // Recent batches: when each finished, its chunks and how long it took.
  const batches: Array<{ at: number; chunks: number; ms: number }> = []
  return {
    record(chunks: number, ms: number) {
      const at = now()
      batches.push({ at, chunks, ms })
      while (batches.length > 0 && at - batches[0]!.at > RATE_WINDOW_MS) batches.shift()
    },
    reset() {
      batches.length = 0
    },
    /** Null before the first batch. */
    perSecond(): number | null {
      let chunks = 0
      let ms = 0
      for (const batch of batches) {
        chunks += batch.chunks
        ms += batch.ms
      }
      return ms > 0 ? Math.round((chunks / ms) * 10_000) / 10 : null
    },
  }
}

/** A timer that never keeps the process alive; returns its cancel. */
export function unrefTimer(fire: () => void, ms: number): () => void {
  const timer = setTimeout(fire, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}
