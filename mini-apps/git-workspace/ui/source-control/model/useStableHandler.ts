import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * A callback whose identity never changes but which always runs the LATEST `fn`.
 *
 * The defect it prevents: a handler rebuilt every render (because it closes over state from a hook
 * that does not memoize, like the diff openers) defeats `memo` on every row it is passed to — the
 * Changes tree re-rendered all its rows on each poll for that alone. Handlers are only ever
 * called from events, after commit, so reading the ref at call time is always current.
 */
export function useStableHandler<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}
