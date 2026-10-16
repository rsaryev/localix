import { getFileDropActive, subscribeFileDropActive } from './fileDropActive'

type Gesture = { kind: 'drag' } | { kind: 'resize'; pointerId?: number }
let current: Gesture | null = null
const listeners = new Set<() => void>()
const publish = (next: Gesture | null) => {
  current = next
  for (const listener of listeners) listener()
}

/** Native webviews must yield to every app drag, including plugin resources and kit sashes. */
export const workbenchGesture = {
  active: () => current !== null || getFileDropActive(),
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function installWorkbenchGestures(): () => void {
  const unsubscribeFiles = subscribeFileDropActive(() => {
    for (const listener of listeners) listener()
  })
  const startDrag = () => publish({ kind: 'drag' })
  const startResize = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 0 || current) return
    if (!(event.target instanceof Element) || !event.target.closest('[role="separator"]')) return
    publish({ kind: 'resize', pointerId: 'pointerId' in event ? event.pointerId : undefined })
  }
  const finishDrag = () => {
    if (current?.kind === 'drag') publish(null)
  }
  const finishResize = (event: MouseEvent | PointerEvent) => {
    if (current?.kind !== 'resize') return
    if (current.pointerId !== undefined && !('pointerId' in event)) return
    if ('pointerId' in event && current.pointerId !== event.pointerId) return
    publish(null)
  }
  const blur = () => {
    // Losing focus to Finder is part of an outside tab drop, not cancellation.
    if (current?.kind !== 'drag') publish(null)
  }
  document.addEventListener('dragstart', startDrag, true)
  document.addEventListener('dragend', finishDrag, true)
  document.addEventListener('drop', finishDrag, true)
  document.addEventListener('pointerdown', startResize, true)
  document.addEventListener('mousedown', startResize, true)
  window.addEventListener('pointerup', finishResize, true)
  window.addEventListener('pointercancel', finishResize, true)
  window.addEventListener('mouseup', finishResize, true)
  window.addEventListener('blur', blur)
  return () => {
    unsubscribeFiles()
    document.removeEventListener('dragstart', startDrag, true)
    document.removeEventListener('dragend', finishDrag, true)
    document.removeEventListener('drop', finishDrag, true)
    document.removeEventListener('pointerdown', startResize, true)
    document.removeEventListener('mousedown', startResize, true)
    window.removeEventListener('pointerup', finishResize, true)
    window.removeEventListener('pointercancel', finishResize, true)
    window.removeEventListener('mouseup', finishResize, true)
    window.removeEventListener('blur', blur)
    publish(null)
  }
}
