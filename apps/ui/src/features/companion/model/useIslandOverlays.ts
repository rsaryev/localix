import { useEffect } from 'react'
import { ISLAND_OVERLAY_SELECTOR, setIslandGrab } from './islandOverlays'

/** Keep native hit testing over shared, portaled menus while they extend past the glass. */
export function useIslandOverlays(expanded: boolean) {
  useEffect(() => {
    if (!expanded) return
    let grabbing = false
    const update = () => {
      const open = [...document.querySelectorAll(ISLAND_OVERLAY_SELECTOR)].some(
        (element) => element.getAttribute('data-state') !== 'closed',
      )
      if (open === grabbing) return
      grabbing = open
      setIslandGrab(open)
    }
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
    update()
    return () => {
      observer.disconnect()
      setIslandGrab(false)
    }
  }, [expanded])
}
