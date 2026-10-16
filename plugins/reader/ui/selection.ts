export interface ReaderRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface ReaderSelectionToolbarPosition {
  left: number
  top: number
  arrowLeft: number
  placement: 'above' | 'below'
}

export function readerSelectionToolbarPosition(
  anchor: ReaderRect,
  surface: ReaderRect,
  toolbar: { width: number; height: number },
  padding = 8,
  gap = 10,
): ReaderSelectionToolbarPosition {
  const usableWidth = Math.max(0, surface.width - padding * 2)
  const usableHeight = Math.max(0, surface.height - padding * 2)
  const width = Math.min(Math.max(0, toolbar.width), usableWidth)
  const height = Math.min(Math.max(0, toolbar.height), usableHeight)
  const above = anchor.top - surface.top - padding
  const below = surface.bottom - anchor.bottom - padding
  const placement = above >= height + gap || above >= below ? 'above' : 'below'
  const preferredTop =
    placement === 'above'
      ? anchor.top - surface.top - gap - height
      : anchor.bottom - surface.top + gap
  const preferredLeft = anchor.left + anchor.width / 2 - surface.left - width / 2
  const left = Math.max(padding, Math.min(surface.width - padding - width, preferredLeft))
  const anchorCenter = anchor.left + anchor.width / 2 - surface.left
  const arrowInset = Math.min(12, width / 2)

  return {
    left,
    top: Math.max(padding, Math.min(surface.height - padding - height, preferredTop)),
    arrowLeft: Math.max(arrowInset, Math.min(width - arrowInset, anchorCenter - left)),
    placement,
  }
}

function intersects(rect: DOMRect, viewport: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom &&
    rect.right > viewport.left &&
    rect.left < viewport.right
  )
}

export function readerSelectionFocusAtStart(selection: Selection, range: Range): boolean {
  return selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset
}

/** Returns the visible range edge nearest the user's active selection handle. */
export function readerSelectionAnchorRect(
  range: Range,
  viewport: HTMLElement,
  focusAtStart: boolean,
): DOMRect | null {
  const viewportRect = viewport.getBoundingClientRect()
  const visibleRects = Array.from(range.getClientRects()).filter((rect) =>
    intersects(rect, viewportRect),
  )
  if (!visibleRects.length) return null
  const focusRect = focusAtStart ? visibleRects[0]! : visibleRects.at(-1)!
  const top = Math.min(...visibleRects.map((rect) => rect.top))
  const bottom = Math.max(...visibleRects.map((rect) => rect.bottom))
  return {
    x: focusRect.left,
    y: top,
    left: focusRect.left,
    top,
    right: focusRect.right,
    bottom,
    width: focusRect.width,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect
}
