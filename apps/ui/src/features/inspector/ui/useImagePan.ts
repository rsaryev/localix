import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

type Pan = {
  element: HTMLDivElement
  pointerId: number
  startX: number
  startY: number
  scrollX: number
  scrollY: number
  frame: number | null
  pending: { x: number; y: number } | null
  removeListeners: () => void
}

/** Image panning owns one primary pointer and yields every capture when it ends. */
export function useImagePan(enabled: boolean) {
  const panRef = useRef<Pan | null>(null)
  const suppressClickRef = useRef(false)
  const [isPanning, setIsPanning] = useState(false)

  const flush = useCallback((pan: Pan) => {
    pan.frame = null
    if (!pan.pending) return
    pan.element.scrollLeft = pan.scrollX - (pan.pending.x - pan.startX)
    pan.element.scrollTop = pan.scrollY - (pan.pending.y - pan.startY)
    pan.pending = null
  }, [])

  const finish = useCallback(
    (cancelled = false) => {
      const pan = panRef.current
      if (!pan) return
      panRef.current = null
      pan.removeListeners()
      if (pan.frame !== null) cancelAnimationFrame(pan.frame)
      if (!cancelled) flush(pan)
      if (pan.element.hasPointerCapture?.(pan.pointerId)) {
        pan.element.releasePointerCapture(pan.pointerId)
      }
      setIsPanning(false)
    },
    [flush],
  )

  const bindPointer = useCallback(() => {
    const move = (event: globalThis.PointerEvent) => {
      const pan = panRef.current
      if (!pan || pan.pointerId !== event.pointerId) return
      if (event.buttons === 0) {
        finish()
        return
      }
      const dx = event.clientX - pan.startX
      const dy = event.clientY - pan.startY
      if (!suppressClickRef.current) {
        if (Math.hypot(dx, dy) <= 3) return
        // Capture only after intent is clear: an ordinary image click keeps its target.
        suppressClickRef.current = true
        try {
          pan.element.setPointerCapture(event.pointerId)
        } catch {
          finish(true)
          return
        }
        setIsPanning(true)
      }
      event.preventDefault()
      pan.pending = { x: event.clientX, y: event.clientY }
      if (pan.frame === null) pan.frame = requestAnimationFrame(() => flush(pan))
    }
    const up = (event: globalThis.PointerEvent) => {
      if (panRef.current?.pointerId === event.pointerId) finish()
    }
    const cancel = (event: globalThis.PointerEvent) => {
      if (panRef.current?.pointerId === event.pointerId) finish(true)
    }
    const blur = () => finish(true)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', blur)
    }
  }, [finish, flush])

  useEffect(() => () => finish(true), [finish])

  useEffect(() => {
    if (!enabled) finish(true)
  }, [enabled, finish])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (panRef.current || event.button !== 0 || !event.isPrimary) return
      // Suppress only the trailing click of a pan; the next primary interaction is a new click.
      suppressClickRef.current = false
      const element = event.currentTarget
      if (
        !enabled ||
        (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)
      ) {
        return
      }
      panRef.current = {
        element,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollX: element.scrollLeft,
        scrollY: element.scrollTop,
        frame: null,
        pending: null,
        removeListeners: bindPointer(),
      }
    },
    [bindPointer, enabled],
  )
  const onLostPointerCapture = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (panRef.current?.pointerId === event.pointerId) finish(true)
    },
    [finish],
  )

  const wasPanned = useCallback(() => suppressClickRef.current, [])

  return {
    isPanning,
    wasPanned,
    onPointerDown,
    onLostPointerCapture,
  }
}
