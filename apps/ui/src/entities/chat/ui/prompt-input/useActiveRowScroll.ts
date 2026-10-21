import { useEffect, useRef } from 'react'

/**
 * Keyboard-active-row scroll behaviour shared by the composer's pop-up menus
 * (CompletionMenu — slash commands + @-refs — and the slash-arg picker).
 *
 * Only KEYBOARD navigation scrolls the active row into view. Scrolling on a
 * pointer-driven index change creates a feedback loop: the nudge slides a new row
 * under the stationary cursor and can move the index again. Rows update selection
 * on actual `mousemove` (not `mouseenter`), and `markPointerNav()` makes the next
 * effect skip programmatic scrolling.
 */
export function useActiveRowScroll<T extends HTMLElement = HTMLButtonElement>(activeIndex: number) {
  const activeRef = useRef<T>(null)
  const pointerNav = useRef(false)

  useEffect(() => {
    if (pointerNav.current) {
      pointerNav.current = false
      return
    }
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const markPointerNav = () => {
    pointerNav.current = true
  }

  return { activeRef, markPointerNav }
}
