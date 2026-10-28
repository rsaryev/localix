import type { ReactNode, RefObject } from 'react'

/**
 * The two gestures the sidebar's roster understands for its batch selection: Escape anywhere in
 * it, and a click on the roster's own empty space, both clear the selection.
 *
 * A wrapper rather than handlers on the landmark and the scroll region, which are not interactive
 * elements. It is `presentation` and lays out as `contents`, so it adds no box of its own.
 */
export function SelectionGestures({
  active,
  onClear,
  emptySpaceRef,
  children,
}: {
  /** A batch selection exists, so there is something to clear. */
  active: boolean
  onClear: () => void
  /** The roster's scroll region: a click that lands on it directly, not on a row, is empty space. */
  emptySpaceRef: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  return (
    <div
      role="presentation"
      className="contents"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && active) {
          event.stopPropagation()
          onClear()
        }
      }}
      onClick={(event) => {
        if (event.target === emptySpaceRef.current && active) onClear()
      }}
    >
      {children}
    </div>
  )
}
