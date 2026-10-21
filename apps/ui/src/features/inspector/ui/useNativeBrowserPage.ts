import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { overlayOnScreen, useFocusStack } from '@localixai/plugin-sdk/ui/focus'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { workbenchGesture } from '@/shared/lib/workbenchGesture'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import { browserTransferReadyKey, workItemTransferReady } from '@/shared/lib/workItemTransferReady'
import { latestOnly } from '../model/latestOnly'
import { visibleNativePageFrame } from '../model/nativePageFrame'
import {
  createNativePageLayer,
  type NativePageLayer,
  type PageBounds,
} from '../model/nativePageLayer'

interface BrowserImage {
  data: string
  mediaType: string
}

/**
 * Glue one native page to its host box: open it, follow the box's frame, hide it with its tab,
 * and let it step aside for app overlays behind a picture of itself (`nativePageLayer.ts`).
 *
 * The frame is followed by observation, not polling: a pane resize resizes the box (its
 * `ResizeObserver`), a window resize or scroll moves it (the window listeners), and a maximized
 * group changes visibility through the observed ancestor attributes.
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
  const finishPicture = useRef<(() => void) | null>(null)
  const handlers = useLatestRef({ onOpened, onError })

  useLayoutEffect(() => {
    const invoke = platformCapabilities().desktop.invoker()
    const host = hostRef.current
    if (!invoke || !host) return
    const lease = nativePageRendererLease.claim(tabId)
    let disposed = false
    const report = (reason: unknown) => {
      if (!disposed && nativePageRendererLease.current(tabId, lease)) {
        workItemTransferReady.failure(browserTransferReadyKey(tabId), String(reason))
        handlers.current.onError(String(reason))
      }
    }
    const applyBounds = latestOnly(async (bounds: PageBounds) => {
      await invoke('browser_bounds', { tabId, lease, bounds })
      if (bounds.visible && !disposed && nativePageRendererLease.current(tabId, lease)) {
        workItemTransferReady.success(browserTransferReadyKey(tabId))
      }
    }, report)
    const layer = createNativePageLayer({
      apply: applyBounds,
      capture: async () => {
        const image = (await invoke('browser_placeholder', { tabId })) as BrowserImage
        return `data:${image.mediaType};base64,${image.data}`
      },
      showPicture: (next) => {
        if (disposed) return Promise.resolve()
        finishPicture.current?.()
        return new Promise<void>((resolve) => {
          // Settled one frame after the picture loads, i.e. once it is painted: hiding the page
          // any earlier leaves a frame of empty box between the page and its picture.
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            resolve()
          }
          finishPicture.current = finish
          pictureLoaded.current = () => requestAnimationFrame(finish)
          setPicture(next)
        })
      },
      setPaused: (next) => {
        if (!disposed) setPaused(next)
      },
      schedule: (task, ms) => {
        const timer = setTimeout(task, ms)
        return () => clearTimeout(timer)
      },
    })
    layerRef.current = layer

    const measure = () => layer.setFrame(visibleNativePageFrame(host))
    const followOverlays = () => {
      const gesture = workbenchGesture.active()
      layer.setOverlay(gesture || overlayOnScreen(useFocusStack.getState().entries), gesture)
    }
    const observer = new ResizeObserver(measure)
    const mutations = new MutationObserver(measure)
    for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor)
      mutations.observe(ancestor, {
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'inert'],
      })
    }
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const stopFollowingOverlays = useFocusStack.subscribe(followOverlays)
    const stopFollowingGestures = workbenchGesture.subscribe(followOverlays)
    followOverlays()
    measure()

    void invoke('browser_open', { tabId, url, lease }).then(() => {
      if (disposed || !nativePageRendererLease.current(tabId, lease)) {
        // Release the exact old controller. The native lease prevents this from hiding a remount.
        void invoke('browser_release', { tabId, lease }).catch(() => {})
        return
      }
      layer.opened()
      handlers.current.onOpened()
    }, report)

    return () => {
      disposed = true
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      stopFollowingOverlays()
      stopFollowingGestures()
      layer.dispose()
      // Keep the terminal hide behind any in-flight frame. cancel() would discard it.
      applyBounds.dispose({ x: 0, y: 0, width: 0, height: 0, visible: false })
      nativePageRendererLease.release(tabId, lease)
      void invoke('browser_release', { tabId, lease }).catch(() => {})
      layerRef.current = null
      finishPicture.current?.()
      finishPicture.current = null
      pictureLoaded.current = null
    }
    // `url` is only the first address: reopening on navigation would throw away the page and
    // its history. The latest handlers are read through `handlers`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // Declared after the effect that creates the layer, so a new layer learns the tab's state in
  // the same commit that built it.
  useLayoutEffect(() => {
    layerRef.current?.setActive(active)
  }, [active, tabId])

  const onPictureLoad = useCallback(() => {
    pictureLoaded.current?.()
    pictureLoaded.current = null
  }, [])

  return { hostRef, picture, onPictureLoad, paused }
}
