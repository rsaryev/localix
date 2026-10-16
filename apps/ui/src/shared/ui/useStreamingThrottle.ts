import { useEffect, useRef, useState } from 'react'

export const STREAM_MARKDOWN_REPARSE_MS = 40
const STREAM_MARKDOWN_REPARSE_MAX_MS = 320
const REPARSE_BACKOFF_THRESHOLD = 12_000

function reparseIntervalFor(length: number): number {
  if (length <= REPARSE_BACKOFF_THRESHOLD) return STREAM_MARKDOWN_REPARSE_MS
  const extra = (length / REPARSE_BACKOFF_THRESHOLD) * STREAM_MARKDOWN_REPARSE_MS
  return Math.min(STREAM_MARKDOWN_REPARSE_MAX_MS, STREAM_MARKDOWN_REPARSE_MS + extra)
}

/**
 * Returns `value` verbatim when not streaming (so the final, complete text is
 * never a throttled-stale frame), and a leading+trailing throttled view while
 * streaming so the expensive parse runs at most every `intervalMs`.
 */
export function useStreamingThrottle(
  value: string,
  isStreaming: boolean,
  intervalMs: number,
): string {
  const [shown, setShown] = useState(value)
  const valueRef = useRef(value)
  const lastCommitRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    valueRef.current = value
    if (!isStreaming) {
      // Not streaming → the render path returns `value` directly; just make
      // sure no stale trailing commit fires later.
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      return
    }
    // A trailing commit is already scheduled — it reads valueRef, so it will
    // pick up the latest text without us scheduling a second timer.
    if (timerRef.current !== undefined) return
    const interval = Math.max(intervalMs, reparseIntervalFor(value.length))
    const elapsed = Date.now() - lastCommitRef.current
    // Always commit via a timer (0ms when the cadence already elapsed) — a
    // synchronous setState here would cascade a second render per delta.
    timerRef.current = window.setTimeout(
      () => {
        timerRef.current = undefined
        lastCommitRef.current = Date.now()
        setShown(valueRef.current)
      },
      Math.max(0, interval - elapsed),
    )
  }, [value, isStreaming, intervalMs])

  useEffect(
    () => () => {
      // Must also RESET the ref, not just clear the timeout: under StrictMode
      // this cleanup runs between the doubled mount effects, and a stale ref
      // would make every later effect run think a commit is already scheduled —
      // freezing the stream until reload.
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    },
    [],
  )

  return isStreaming ? shown : value
}
