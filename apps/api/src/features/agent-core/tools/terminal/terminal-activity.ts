/**
 * Wake a terminal wait on the PTY's own events instead of a fixed re-render timer.
 *
 * `wait` and the settle after `open`/`keys`/`type` used to re-render the whole VT screen every
 * 80ms for as long as they ran — up to two minutes of renders for a screen that, between two
 * output chunks, cannot change. A screen changes only when output arrives (or the program
 * exits), so those are the only things that wake a re-check here; the one timer left is the
 * caller's deadline (the quiet window, the wait cap).
 *
 * Output is coalesced, not dropped: a chunk that lands while a render is running marks the
 * screen dirty and the next `next()` returns at once. A firehose is throttled to one wake per
 * {@link MIN_WAKE_GAP_MS}, so a chatty program costs a bounded render rate while it talks and
 * nothing at all while it is silent.
 */

/** Subscribe to one terminal's output and exit; null when no live terminal has that id. */
export type TerminalWatch = (
  terminalId: string,
  onEvent: (event: 'output' | 'exit') => void,
) => (() => void) | null

export type ActivityWake = 'output' | 'exit' | 'deadline' | 'aborted'

export interface TerminalActivity {
  /** Resolve on the next output burst, the exit, the abort, or `deadline` (epoch ms). */
  next(deadline: number): Promise<ActivityWake>
  close(): void
}

/** Floor between two output wakes — the old poll's render rate, now paid only while output flows. */
export const MIN_WAKE_GAP_MS = 50

export function watchTerminalActivity(
  watch: TerminalWatch,
  terminalId: string,
  signal?: AbortSignal,
): TerminalActivity {
  let dirty = false
  let exited = false
  let lastWakeAt = 0
  let wake: (() => void) | null = null
  const poke = () => {
    const resolve = wake
    wake = null
    resolve?.()
  }
  const unsubscribe =
    watch(terminalId, (event) => {
      if (event === 'exit') exited = true
      else dirty = true
      poke()
    }) ?? null
  // An id the host no longer knows is a terminal that already exited.
  if (!unsubscribe) exited = true
  signal?.addEventListener('abort', poke)

  const settled = (now: number, deadline: number): ActivityWake | null => {
    if (signal?.aborted) return 'aborted'
    if (exited) return 'exit'
    if (now >= deadline) return 'deadline'
    if (dirty && now - lastWakeAt >= MIN_WAKE_GAP_MS) {
      dirty = false
      lastWakeAt = now
      return 'output'
    }
    return null
  }

  return {
    async next(deadline) {
      for (;;) {
        const now = Date.now()
        const done = settled(now, deadline)
        if (done) return done
        // Sleep until the deadline, or — with output already pending — until the throttle
        // opens; any event pokes earlier.
        const until = dirty ? Math.min(deadline, lastWakeAt + MIN_WAKE_GAP_MS) : deadline
        await new Promise<void>((resolve) => {
          const timer = setTimeout(poke, Math.max(0, until - now))
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }
    },
    close() {
      unsubscribe?.()
      signal?.removeEventListener('abort', poke)
      poke()
    },
  }
}
