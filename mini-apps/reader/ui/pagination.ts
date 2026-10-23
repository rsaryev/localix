export type ReaderPaginationMode = 'scroll' | 'page'

export interface ReaderPagePosition {
  current: number
  total: number
}

export function readerViewportFraction(
  offset: number,
  scrollExtent: number,
  viewportExtent: number,
): number {
  const denominator = Math.max(1, scrollExtent - viewportExtent)
  return Math.max(0, Math.min(1, offset / denominator))
}

export function readerPagePosition(
  offset: number,
  scrollExtent: number,
  viewportExtent: number,
): ReaderPagePosition {
  const viewport = Math.max(1, viewportExtent)
  const total = Math.max(1, Math.ceil(scrollExtent / viewport))
  const current = Math.max(1, Math.min(total, Math.round(offset / viewport) + 1))
  return { current, total }
}

export function readerPageOffsetAtFraction(
  fractionValue: number,
  scrollExtent: number,
  viewportExtent: number,
): number {
  const viewport = Math.max(1, viewportExtent)
  const maximum = Math.max(0, scrollExtent - viewport)
  const fraction = Math.max(0, Math.min(1, fractionValue))
  const page = Math.round((fraction * maximum) / viewport)
  return Math.max(0, Math.min(maximum, page * viewport))
}

/** Align an arbitrary browser-produced horizontal offset to one complete Reader page. */
export function readerPageOffsetAtOffset(
  offsetValue: number,
  scrollExtent: number,
  viewportExtent: number,
): number {
  const viewport = Math.max(1, viewportExtent)
  const maximum = Math.max(0, scrollExtent - viewport)
  const offset = Math.max(0, Math.min(maximum, offsetValue))
  return Math.max(0, Math.min(maximum, Math.round(offset / viewport) * viewport))
}

const READER_PAGE_TAB_STOP_SELECTOR =
  'a[href],button,input:not([type="hidden"]),select,textarea,summary,audio[controls],video[controls],iframe,pre,[contenteditable="true"],[tabindex]'

export interface ReaderPageTabStopResult {
  visible: number
  hidden: number
  activeElementHidden: boolean
}

/**
 * Keeps sequential keyboard focus on the visible column in paginated mode.
 *
 * CSS columns leave links and figure buttons from every page in the DOM. Without
 * this guard, Tab can move focus tens of screens away while the viewport stays on
 * the current page. Original tabindex values are captured only while an element
 * is hidden, then restored as soon as that element returns to the viewport or the
 * reader switches back to scroll mode.
 */
export function syncReaderPageTabStops(
  root: HTMLElement,
  viewport: HTMLElement,
  paginated: boolean,
  hiddenTabIndexes: Map<HTMLElement, string | null>,
  activeElement: Element | null = root.ownerDocument.activeElement,
): ReaderPageTabStopResult {
  let visible = 0
  let hidden = 0
  let activeElementHidden = false

  const restore = (element: HTMLElement, value: string | null) => {
    if (value === null) element.removeAttribute('tabindex')
    else element.setAttribute('tabindex', value)
  }

  for (const [element, value] of hiddenTabIndexes) {
    if (paginated && root.contains(element)) continue
    restore(element, value)
    hiddenTabIndexes.delete(element)
  }
  if (!paginated) return { visible, hidden, activeElementHidden }

  const viewportRect = viewport.getBoundingClientRect()
  for (const element of root.querySelectorAll<HTMLElement>(READER_PAGE_TAB_STOP_SELECTOR)) {
    const intersects = Array.from(element.getClientRects()).some(
      (rect) =>
        rect.bottom > viewportRect.top &&
        rect.top < viewportRect.bottom &&
        rect.right > viewportRect.left &&
        rect.left < viewportRect.right,
    )
    if (intersects) {
      visible += 1
      const original = hiddenTabIndexes.get(element)
      if (original !== undefined || hiddenTabIndexes.has(element)) {
        restore(element, original ?? null)
        hiddenTabIndexes.delete(element)
      }
      continue
    }

    hidden += 1
    if (!hiddenTabIndexes.has(element)) {
      hiddenTabIndexes.set(element, element.getAttribute('tabindex'))
    }
    element.tabIndex = -1
    if (activeElement === element || (activeElement !== null && element.contains(activeElement))) {
      activeElementHidden = true
    }
  }

  return { visible, hidden, activeElementHidden }
}
