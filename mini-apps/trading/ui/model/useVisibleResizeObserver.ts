import { useEffect, useRef, type RefObject } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

/**
 * Observe a keep-alive surface only while its grid work item can paint.
 *
 * The callback runs once immediately on resume, which matters for a chart first mounted under
 * `display:none`: its initial box is 0×0 and no observer was attached while parked to discover the
 * later size. The latest callback lives in a ref so render-local measurement logic never churns
 * the observer.
 */
export function useVisibleResizeObserver<T extends Element>(
  targetRef: RefObject<T | null>,
  onResize: (element: T) => void,
  enabled = true,
): void {
  const workItemVisible = useWorkItemVisible()
  const callbackRef = useRef(onResize)
  useEffect(() => {
    callbackRef.current = onResize
  }, [onResize])

  useEffect(() => {
    if (!enabled || !workItemVisible || typeof ResizeObserver === 'undefined') return
    const element = targetRef.current
    if (!element) return
    const measure = () => callbackRef.current(element)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, targetRef, workItemVisible])
}
