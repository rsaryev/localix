import { useEffect, useState } from 'react'

/**
 * The wall clock as state: the time at the first render, then re-read every `intervalMs`.
 * A component that shows something time-dependent (a hold that lapses) reads it from here rather
 * than calling `Date.now()` while rendering, which would make each render's output depend on
 * when it happened to run.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
