/**
 * The last frame a live preview painted, kept so a dead one can show the page it used to
 * be instead of an empty pane — the same reason a disconnected terminal keeps its
 * scrollback on screen behind the notice.
 *
 * In memory only, and deliberately: a frame is a JPEG data URL the in-page probe rendered,
 * it is a ghost rather than evidence, and one restored from a previous app run would
 * misrepresent the page harder than showing nothing at all. A small LRU bounds it —
 * several previews can be open at once and each entry is a few hundred kilobytes.
 */

export interface PreviewFrame {
  /** JPEG data URL rendered in-page by the Visual Feedback probe. */
  src: string
  width: number
  height: number
  capturedAt: number
}

/** Enough for the previews a person keeps open; the rest are dropped oldest-first. */
const LIMIT = 4

/** Past this a frame stops describing the page, and showing nothing is more honest. */
export const PREVIEW_FRAME_MAX_AGE_MS = 30 * 60_000

const frames = new Map<string, PreviewFrame>()

export function rememberPreviewFrame(url: string, frame: PreviewFrame): void {
  // Re-inserting moves the key to the end of the Map's insertion order, which is what
  // makes the eviction below least-recently-written rather than first-ever-seen.
  frames.delete(url)
  frames.set(url, frame)
  while (frames.size > LIMIT) {
    const oldest = frames.keys().next()
    if (oldest.done) break
    frames.delete(oldest.value)
  }
}

export function readPreviewFrame(url: string, now: number = Date.now()): PreviewFrame | null {
  const frame = frames.get(url)
  if (!frame) return null
  if (now - frame.capturedAt > PREVIEW_FRAME_MAX_AGE_MS) {
    frames.delete(url)
    return null
  }
  return frame
}

/** Drop everything — a preview closed for good, and in tests between cases. */
export function forgetPreviewFrames(): void {
  frames.clear()
}
