/**
 * An element's screenshot in a native tab, cut from the WebView's own capture.
 *
 * The in-page rasterizer redraws the element from a clone of the DOM, its styles, fonts and
 * images — on a large site that took 6–11 s a shot (Wikipedia, 2026-10-20), while the WebView
 * captures its visible pixels in a fifth of a second. So the probe only brings the element into
 * view and says where it is (`locateOnly`), the host captures the viewport, and this cuts the
 * element out with a little of its surroundings, at the size the rasterizer used.
 */

export interface ShotImage {
  data: string
  mediaType: string
  width: number
  height: number
}

export interface ShotRect {
  x: number
  y: number
  width: number
  height: number
}

/** Context kept around the element, as a share of its size — the rasterizer's own margin. */
const CONTEXT_RATIO = 0.15
/** The longest edge of the picture sent to the model, as the rasterizer sends it. */
const MAX_EDGE = 1000
const JPEG_QUALITY = 0.92

/** The crop box in capture pixels: the element plus its margin, clamped to the capture. */
export function cropBox(
  rect: ShotRect,
  viewport: { width: number; height: number },
  capture: { width: number; height: number },
): ShotRect | null {
  const scale = viewport.width > 0 ? capture.width / viewport.width : 1
  const marginX = rect.width * CONTEXT_RATIO
  const marginY = rect.height * CONTEXT_RATIO
  const left = Math.max(0, Math.floor((rect.x - marginX) * scale))
  const top = Math.max(0, Math.floor((rect.y - marginY) * scale))
  const right = Math.min(capture.width, Math.ceil((rect.x + rect.width + marginX) * scale))
  const bottom = Math.min(capture.height, Math.ceil((rect.y + rect.height + marginY) * scale))
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Cut `box` out of the capture and encode it as the model's JPEG. */
export async function cropImage(image: ShotImage, box: ShotRect): Promise<ShotImage> {
  const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: image.mediaType }))
  try {
    const fit = Math.min(1, MAX_EDGE / Math.max(box.width, box.height))
    const width = Math.max(1, Math.round(box.width * fit))
    const height = Math.max(1, Math.round(box.height * fit))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas to cut the screenshot with')
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, width, height)
    const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', width, height }
  } finally {
    bitmap.close()
  }
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>
type RunInPage = (
  invoke: Invoke,
  tabId: string,
  commandId: string,
  command: unknown,
) => Promise<{ ok: boolean; result?: Record<string, unknown> } | 'replaced' | null>

/**
 * The element screenshot a native tab answers with, or null when it cannot cut one (the target
 * did not resolve, or this platform has no WebView capture) — the caller then lets the probe
 * rasterize it the slow way, which also reports why a target is missing.
 */
export async function elementShot(
  invoke: Invoke,
  runInPage: RunInPage,
  tabId: string,
  commandId: string,
  command: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const located = await runInPage(invoke, tabId, `${commandId}:locate`, {
    ...command,
    locateOnly: true,
  })
  if (!located || located === 'replaced' || !located.ok || !located.result) return null
  const { rect, viewport } = located.result as {
    rect?: ShotRect | null
    viewport?: { width: number; height: number }
  }
  if (!rect || !viewport) return null
  let capture: ShotImage
  try {
    capture = (await invoke('browser_snapshot', { tabId })) as ShotImage
  } catch {
    return null
  }
  const box = cropBox(rect, viewport, capture)
  if (!box) return null
  return { ...located.result, image: await cropImage(capture, box) }
}
