import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readPreviewFrame,
  rememberPreviewFrame,
  type PreviewFrame,
} from '../model/previewLastFrame'

/** Let the page settle (fonts, first data, entry animation) before it is photographed. */
const SETTLE_MS = 2_500
/** Slow enough that a person browsing never feels it; fresh enough to still be the page. */
const REFRESH_MS = 120_000
/** Never photograph the same preview twice in quick succession (tab flips, reloads). */
const MIN_GAP_MS = 15_000
/**
 * A capture slower than this made the previewed page hitch. One ghost frame is worth a
 * hitch; a hitch every couple of minutes is not — so a heavy page keeps the settle shot
 * and no refreshes.
 */
const EXPENSIVE_CAPTURE_MS = 400

interface PreviewLastFrameOptions {
  /** False while a keep-alive preview body is mounted but hidden. */
  active: boolean
  url: string
  /** Identity of the loaded document — a reload/repoint earns a fresh photograph. */
  frameKey: string
  /** The probe is connected: it is the only thing that can rasterize the page. */
  connected: boolean
  /** The server answers AND a document actually painted. */
  live: boolean
  captureElement: (selector: string) => Promise<{
    data: string
    mediaType: string
    width: number
    height: number
  } | null>
  /** Test seam: the settle delay, so a test need not wait two and a half real seconds. */
  settleMs?: number
}

/**
 * Keeps a photograph of the preview while it is alive, so the dormant pane can show the
 * page as it last was instead of an empty rectangle (see {@link PreviewDormantSurface}).
 *
 * The probe rasterizes in-page, so every capture costs the previewed app some main-thread
 * time — the reason this is throttled hard rather than run on a timer: one shot once the
 * document settles, then a slow refresh that a page expensive to rasterize opts itself out
 * of. A failed capture is swallowed: a missing ghost frame degrades to the themed fallback,
 * and a toast about it would be noise about a decoration.
 */
export function usePreviewLastFrame({
  active,
  url,
  frameKey,
  connected,
  live,
  captureElement,
  settleMs = SETTLE_MS,
}: PreviewLastFrameOptions): PreviewFrame | null {
  const [frame, setFrame] = useState<PreviewFrame | null>(() => readPreviewFrame(url))
  const busyRef = useRef(false)
  const lastAtRef = useRef(0)
  const expensiveRef = useRef(false)

  // A repointed preview (the static server was re-served on a fresh port) is a different
  // url with its own history — adopt whatever the cache already holds for it.
  useEffect(() => setFrame(readPreviewFrame(url)), [url])

  const capture = useCallback(async () => {
    if (busyRef.current || Date.now() - lastAtRef.current < MIN_GAP_MS) return
    busyRef.current = true
    const startedAt = performance.now()
    try {
      const image = await captureElement('body')
      if (image) {
        const next: PreviewFrame = {
          src: `data:${image.mediaType};base64,${image.data}`,
          width: image.width,
          height: image.height,
          capturedAt: Date.now(),
        }
        rememberPreviewFrame(url, next)
        setFrame(next)
      }
    } catch {
      // Nothing to report: the pane falls back to its themed dormant surface.
    } finally {
      expensiveRef.current = performance.now() - startedAt > EXPENSIVE_CAPTURE_MS
      lastAtRef.current = Date.now()
      busyRef.current = false
    }
  }, [captureElement, url])

  useEffect(() => {
    if (!active || !live || !connected) return
    let cancelled = false
    let refresh: ReturnType<typeof setInterval> | null = null
    const shoot = () => {
      if (!cancelled) void capture()
    }
    const settle = setTimeout(() => {
      shoot()
      refresh = setInterval(() => {
        // A hidden window paints nothing worth photographing, and a page that already
        // proved expensive keeps the one frame it gave us.
        if (!expensiveRef.current && document.visibilityState === 'visible') shoot()
      }, REFRESH_MS)
    }, settleMs)
    return () => {
      cancelled = true
      clearTimeout(settle)
      if (refresh) clearInterval(refresh)
    }
  }, [active, live, connected, frameKey, settleMs, capture])

  return frame
}
