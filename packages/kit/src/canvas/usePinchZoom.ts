import { useEffect, type RefObject } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { zoomAt, type CameraViewport } from './camera'

/**
 * Trackpad pinch in WebKit — the engine of the desktop app on macOS.
 *
 * Chromium reports a pinch as a `wheel` event with `ctrlKey`, which the flow library's
 * `zoomOnPinch` handles. WebKit instead sends its own `gesturestart/change/end` events and no
 * wheel at all, so without this a pinch did nothing and only a click-drag moved the camera (the
 * database diagram shipped exactly so). The zoom keeps the point under the fingers fixed, and a
 * ctrl-wheel that some WebKit builds send DURING a gesture is swallowed so a pinch never zooms
 * twice.
 */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

export function usePinchZoom(ref: RefObject<HTMLElement | null>) {
  const flow = useReactFlow()
  const store = useStoreApi()
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let start: CameraViewport | null = null

    const onStart = (event: Event) => {
      event.preventDefault()
      start = flow.getViewport()
    }
    const onChange = (event: Event) => {
      event.preventDefault()
      if (!start) return
      const gesture = event as GestureEvent
      const rect = element.getBoundingClientRect()
      const { minZoom, maxZoom } = store.getState()
      const anchor = { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top }
      void flow.setViewport(
        zoomAt(start, anchor, start.zoom * gesture.scale, { min: minZoom, max: maxZoom }),
      )
    }
    const onEnd = (event: Event) => {
      event.preventDefault()
      start = null
    }
    const swallowDuplicate = (event: WheelEvent) => {
      if (start && event.ctrlKey) event.stopPropagation()
    }

    const options = { passive: false } as const
    element.addEventListener('gesturestart', onStart, options)
    element.addEventListener('gesturechange', onChange, options)
    element.addEventListener('gestureend', onEnd, options)
    element.addEventListener('wheel', swallowDuplicate, { capture: true, passive: true })
    return () => {
      element.removeEventListener('gesturestart', onStart)
      element.removeEventListener('gesturechange', onChange)
      element.removeEventListener('gestureend', onEnd)
      element.removeEventListener('wheel', swallowDuplicate, { capture: true })
    }
  }, [ref, flow, store])
}
