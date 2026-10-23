import { useMemo } from 'react'

/**
 * Keep the previous object while every field is identical — one object per REAL change.
 *
 * A hook that returns a fresh object literal each render invalidates every `useCallback` and
 * `memo` keyed on it, even when nothing it carries moved. The field VALUES are the dependency
 * list: React compares them with `Object.is`, which is a shallow compare, in the same render (no
 * second pass), and the list can never drift from the object it guards the way a hand-written one
 * would. The object's key set must stay fixed, which a hook's return shape is.
 */
export function useShallowStable<T extends object>(value: T): T {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the values ARE the dependencies
  return useMemo(() => value, Object.values(value))
}
