import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * The largest whole font size, between `min` and `max`, at which `fits` holds — a binary search,
 * so a note is measured about six times rather than once per pixel. Text that does not fit even
 * at `min` gets `min` and scrolls; a note never draws its text smaller than legible.
 */
export function fitFontSize(fits: (px: number) => boolean, min: number, max: number): number {
  if (fits(max)) return max
  let low = min
  let high = max
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid)) low = mid
    else high = mid
  }
  return low
}

/**
 * 32px at most: past it a three-line checklist set as a poster wraps every item mid-phrase, and a
 * sticky note reads as a heading rather than a note.
 */
export const NOTE_FIT = { min: 12, max: 32 } as const

/**
 * Auto-sized text, as a sticky note on paper: the text takes the largest size its box holds and
 * shrinks as it grows. `content` is the text and `box` the space it may fill. The size is set on
 * the content directly while measuring, then kept as state, so React draws the answer.
 *
 * `key` names everything that changes what fits — the text, its face, the element's size — and
 * a resize of the box itself re-measures too.
 */
/**
 * The size the text takes in the frame as it is laid out now, or null while the frame has no room
 * (a hidden tab). The text's own size is set while measuring and put back after, so nothing shows.
 */
function measureFit(frame: HTMLElement, text: HTMLElement): number | null {
  const room = { w: frame.clientWidth, h: frame.clientHeight }
  if (room.w === 0 || room.h === 0) return null
  const before = text.style.fontSize
  const next = fitFontSize(
    (px) => {
      text.style.fontSize = `${px}px`
      return text.scrollHeight <= room.h && text.scrollWidth <= room.w
    },
    NOTE_FIT.min,
    NOTE_FIT.max,
  )
  text.style.fontSize = before
  return next
}

export function useFitFont(
  box: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  { active, key }: { active: boolean; key: string },
): number {
  const [size, setSize] = useState<number>(NOTE_FIT.max)
  useLayoutEffect(() => {
    const frame = box.current
    const text = content.current
    if (!active || !frame || !text) return
    const measure = () => {
      // A box not laid out yet (a hidden tab) has no room to measure against.
      const next = measureFit(frame, text)
      if (next !== null) setSize(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [box, content, active, key])
  return size
}
