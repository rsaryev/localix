import { useEffect, useState } from 'react'

/** How long typing rests before the Store searches (`docs/internals/store-scale.md`, "Query path"). */
export const SEARCH_DEBOUNCE_MS = 150

/**
 * `value` once it has stopped changing for `delay` ms: a search reads after the last key, not on
 * every one. An earlier value never lands after a later one; the read it would have started is
 * simply never asked for, and SWR drops the answer to a key no longer shown.
 */
export function useDebounced<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delay <= 0) return
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return delay <= 0 ? value : settled
}
