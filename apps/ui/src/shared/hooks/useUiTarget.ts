import { useCallback, useEffect, useRef, type RefCallback } from 'react'
import { registerUiTarget } from '@/shared/lib/uiTargetRegistry'

/** React ref primitive that makes any rendered element addressable by URI. */
export function useUiTarget<T extends HTMLElement>(uri?: string): RefCallback<T> {
  const unregisterRef = useRef<(() => void) | null>(null)

  const ref = useCallback(
    (element: T | null) => {
      unregisterRef.current?.()
      unregisterRef.current = element && uri ? registerUiTarget(uri, element) : null
    },
    [uri],
  )

  useEffect(
    () => () => {
      unregisterRef.current?.()
      unregisterRef.current = null
    },
    [],
  )

  return ref
}
