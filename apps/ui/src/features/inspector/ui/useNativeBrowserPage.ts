import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { overlayOnScreen, useFocusStack } from '@localixai/plugin-sdk/ui/focus'
import { tauriInvoke } from '@/shared/lib/tauri'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { latestOnly } from '../model/latestOnly'
import {
  createNativePageLayer,
  type NativePageLayer,
  type PageFrame,
} from '../model/nativePageLayer'

interface BrowserImage {
  data: string
  mediaType: string
}

/**
 * The host box's rectangle in window coordinates, or `null` while CSS hides it.
 *
 * `visibility: hidden` keeps a box laid out at full size — a maximized-away grid leaf is exactly
 * that — and the native page knows nothing of CSS, so a hidden box has to read as no frame at all.
 */
function frameOf(host: HTMLElement): PageFrame | null {
  if (getComputedStyle(host).visibility === 'hidden') return null
  const { x, y, width, height } = host.getBoundingClientRect()
  return { x, y, width, height }
}

/**
 * Glue one native page to its host box: open it, follow the box's frame, hide it with its tab,
 * and let it step aside for app overlays behind a picture of itself (`nativePageLayer.ts`).
 *
 * The frame is followed by observation, not polling: a pane resize resizes the box (its
 * `ResizeObserver`), a window resize or scroll moves it (the window listeners), and a maximized
 * group hides it by visibility, which resizes it as well.
 */
export function useNativeBrowserPage({
  tabId,
  url,
  active,
  onOpened,
  onError,
}: {
  tabId: string
  /** The page's first address. Later navigation happens inside the page, not by reopening it. */
  url: string
  active: boolean
  onOpened: () => void
  onError: (message: string) => void
}): {
  hostRef: RefObject<HTMLDivElement | null>
  /** The last picture of the page, painted under it and showing whenever it steps aside. */
  picture: string | null
  onPictureLoad: () => void
  /** The page is stepped aside for an app overlay, and its picture stands in. */
  paused: boolean
} {
  const hostRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<NativePageLayer | null>(null)
  const [picture, setPicture] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const pictureLoaded = useRef<(() => void) | null>(null)
  const handlers = useLatestRef({ onOpened, onError })

  useEffect(() => {
    const invoke = tauriInvoke()
    const host = hostRef.current
    if (!invoke || !host) return
    let disposed = false
    const report = (reason: unknown) => {
      if (!disposed) handlers.current.onError(String(reason))
    }
    const layer = createNativePageLayer({
      apply: latestOnly((bounds) => invoke('browser_bounds', { tabId, bounds }), report),
      capture: async () => {
        const image = (await invoke('browser_placeholder', { tabId })) as BrowserImage
        return `data:${image.mediaType};base64,${image.data}`
      },
      showPicture: (next) =>
        new Promise<void>((resolve) => {
          // Settled one frame after the picture loads, i.e. once it is painted: hiding the page
          // any earlier leaves a frame of empty box between the page and its picture.
          pictureLoaded.current = () => requestAnimationFrame(() => resolve())
          setPicture(next)
        }),
      setPaused: (next) => {
        if (!disposed) setPaused(next)
      },
      schedule: (task, ms) => {
        const timer = setTimeout(task, ms)
        return () => clearTimeout(timer)
      },
    })
    layerRef.current = layer

    const measure = () => layer.setFrame(frameOf(host))
    const followOverlays = () => layer.setOverlay(overlayOnScreen(useFocusStack.getState().entries))
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const stopFollowingOverlays = useFocusStack.subscribe(followOverlays)
    followOverlays()
    measure()

    void invoke('browser_open', { tabId, url }).then(() => {
      if (disposed) return
      layer.opened()
      handlers.current.onOpened()
    }, report)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      stopFollowingOverlays()
      layer.dispose()
      layerRef.current = null
      pictureLoaded.current = null
    }
    // `url` is only the first address: reopening on navigation would throw away the page and
    // its history. The latest handlers are read through `handlers`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // Declared after the effect that creates the layer, so a new layer learns the tab's state in
  // the same commit that built it.
  useEffect(() => {
    layerRef.current?.setActive(active)
  }, [active, tabId])

  const onPictureLoad = useCallback(() => {
    pictureLoaded.current?.()
    pictureLoaded.current = null
  }, [])

  return { hostRef, picture, onPictureLoad, paused }
}
