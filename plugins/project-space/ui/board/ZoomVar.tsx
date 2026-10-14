import { useLayoutEffect, useRef, type RefObject } from 'react'
import { CAMERA_REST_MS, useCanvasZoom } from '@localixai/kit/canvas'

/**
 * The camera's zoom as `--space-zoom` on the board's root, for what is drawn at a fixed SCREEN
 * size — the selection ring, the handles, the connection dots, a frame's title (`space.css`
 * divides by it).
 *
 * A custom property set on the root restyles EVERY element beneath it: written on each frame of a
 * pinch, it made the engine recompute the style of a few thousand nodes sixty times a second, and
 * the camera stuttered; written every few percent of zoom, each write was a visible hitch. It is
 * written ONCE, when the camera rests — and then when the engine is idle, so the one restyle it
 * costs lands after a flight's last frame, not on it. Meanwhile the moving board is scaled as one
 * painted layer (the kit canvas's `will-change`), chrome included, so nothing mid-gesture would
 * show a write anyway. The zoom arrives as React state, so only this component re-renders.
 */
/** WebKit has no `requestIdleCallback`: a beat after the rest is its idle. Return its cleanup. */
const whenIdle = (run: () => void) => {
  const idle = (window as { requestIdleCallback?: Window['requestIdleCallback'] })
    .requestIdleCallback
  if (idle) {
    const id = idle.call(window, run, { timeout: 400 })
    return () => window.cancelIdleCallback(id)
  }
  const timer = window.setTimeout(run, 60)
  return () => window.clearTimeout(timer)
}

export function ZoomVar({ target }: { target: RefObject<HTMLElement | null> }) {
  const zoom = useCanvasZoom()
  const written = useRef<number | null>(null)

  useLayoutEffect(() => {
    const write = (value: number) => {
      written.current = value
      target.current?.style.setProperty('--space-zoom', String(value))
    }
    // The first value is written at once, so the chrome is right before the first gesture.
    if (written.current === null) return write(zoom)
    // Cancelling only the rest timer let an already scheduled idle write apply an old zoom
    // during the next flight (or after unmount). Both stages belong to this effect's lifetime.
    let cancelIdle: (() => void) | undefined
    const settle = window.setTimeout(() => {
      cancelIdle = whenIdle(() => {
        if (written.current !== zoom) write(zoom)
      })
    }, CAMERA_REST_MS)
    return () => {
      window.clearTimeout(settle)
      cancelIdle?.()
    }
  }, [target, zoom])
  return null
}
