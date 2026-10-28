import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

/**
 * One debounced query's lifecycle. Every callback belongs to the render that scheduled the query
 * and runs only while that query is still current: a newer key, an unmount or `supersede()`
 * silences it, including a request that already left the debounce timer.
 */
export interface DebouncedQueryPlan<T> {
  /** Starts the request. `null` = nothing to query: `onIdle` runs and nothing is scheduled. */
  run: (() => Promise<T>) | null
  /** No query to run (cleared input, closed palette, no session). */
  onIdle?: () => void
  /** Synchronously when a query is scheduled — before the debounce (spinners, resets). */
  onStart?: () => void
  onResult: (result: T) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

/**
 * Debounce + last-write-wins sequencing + cancellation for a request driven by `deps`. The query
 * re-runs whenever any dep changes (`Object.is`, like an effect's dependency list). Returns
 * `supersede`, which invalidates whatever is pending or in flight without scheduling anything new.
 */
export function useDebouncedQuery<T>(
  deps: readonly unknown[],
  delayMs: number,
  plan: DebouncedQueryPlan<T>,
): () => void {
  // The plan of the committed render: an effect event reads the latest one without being a dep.
  const latestPlan = useEffectEvent(() => plan)
  const seqRef = useRef(0)
  // A new generation per change of `deps`, adjusted while rendering so the effect below has one
  // plain number to depend on.
  const [tracked, setTracked] = useState({ deps, generation: 0 })
  let generation = tracked.generation
  if (!sameDeps(tracked.deps, deps)) {
    generation += 1
    setTracked({ deps, generation })
  }

  useEffect(() => {
    const current = latestPlan()
    const seq = ++seqRef.current
    let cancelled = false
    const live = () => !cancelled && seq === seqRef.current
    const run = current.run
    if (!run) {
      current.onIdle?.()
      return
    }
    current.onStart?.()
    const timer = setTimeout(() => {
      void run()
        .then((result) => {
          if (live()) current.onResult(result)
        })
        .catch((error: unknown) => {
          if (live()) current.onError?.(error)
        })
        .finally(() => {
          if (live()) current.onSettled?.()
        })
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [generation, delayMs])

  return useCallback(() => {
    seqRef.current += 1
  }, [])
}

function sameDeps(prev: readonly unknown[] | null, next: readonly unknown[]): boolean {
  return (
    prev !== null &&
    prev.length === next.length &&
    prev.every((value, index) => Object.is(value, next[index]))
  )
}
