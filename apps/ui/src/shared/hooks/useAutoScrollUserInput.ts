import { useEffect, type MutableRefObject, type RefObject } from 'react'

const UNPIN_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])

/** Keys that express "scroll up" intent inside the transcript viewport. */
export function isScrollUpKey(key: string, shiftKey: boolean): boolean {
  return UNPIN_KEYS.has(key) || (key === ' ' && shiftKey)
}

interface UserInputOptions {
  scrollRef: RefObject<HTMLElement | null>
  lastScrollTopRef: MutableRefObject<number>
  lastUserInputAtRef: MutableRefObject<number>
  pointerDownRef: MutableRefObject<boolean>
  handleScroll: () => void
  syncPinnedState: () => void
  unpinFromUserIntent: () => void
  catchUpBlockedContent: () => void
  isNestedScrollableTarget: (target: EventTarget | null) => boolean
}

/** Wires wheel/touch/pointer/keyboard listeners that attribute scrolling to the user. */
export function useAutoScrollUserInput({
  scrollRef,
  lastScrollTopRef,
  lastUserInputAtRef,
  pointerDownRef,
  handleScroll,
  syncPinnedState,
  unpinFromUserIntent,
  catchUpBlockedContent,
  isNestedScrollableTarget,
}: UserInputOptions) {
  useEffect(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode) return

    lastScrollTopRef.current = scrollNode.scrollTop
    syncPinnedState()

    const markUserInput = () => {
      lastUserInputAtRef.current = performance.now()
    }
    const handleWheel = (event: WheelEvent) => {
      if (isNestedScrollableTarget(event.target)) return
      markUserInput()
      // Wheel-up is unambiguous "stop following" intent — unpin right away
      // instead of waiting for a scroll event the streaming growth might mask.
      if (event.deltaY < 0) unpinFromUserIntent()
    }
    let touchStartY = 0
    const handleTouchStart = (event: TouchEvent) => {
      markUserInput()
      touchStartY = event.touches[0]?.clientY ?? 0
    }
    const handleTouchMove = (event: TouchEvent) => {
      markUserInput()
      if (isNestedScrollableTarget(event.target)) return
      const y = event.touches[0]?.clientY ?? 0
      // Finger moving down drags the content down = scrolling up.
      if (y > touchStartY + 4) unpinFromUserIntent()
    }

    scrollNode.addEventListener('scroll', handleScroll, { passive: true })
    scrollNode.addEventListener('wheel', handleWheel, { passive: true })
    scrollNode.addEventListener('touchstart', handleTouchStart, { passive: true })
    scrollNode.addEventListener('touchmove', handleTouchMove, { passive: true })
    // Scrollbar drags fire scroll events with no wheel/touch — while the
    // pointer is held down, attribute every scroll event to the user.
    const handlePointerDown = () => {
      pointerDownRef.current = true
      markUserInput()
    }
    const handlePointerEnd = () => {
      if (!pointerDownRef.current) return
      pointerDownRef.current = false
      markUserInput()
      catchUpBlockedContent()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          isNestedScrollableTarget(target))
      ) {
        return
      }
      if (isScrollUpKey(event.key, event.shiftKey)) {
        markUserInput()
        unpinFromUserIntent()
      }
    }
    const handleFocusOut = () => catchUpBlockedContent()
    scrollNode.addEventListener('pointerdown', handlePointerDown, { passive: true })
    scrollNode.addEventListener('keydown', handleKeyDown)
    scrollNode.addEventListener('focusout', handleFocusOut)
    window.addEventListener('pointerup', handlePointerEnd, { passive: true })
    window.addEventListener('pointercancel', handlePointerEnd, { passive: true })
    return () => {
      scrollNode.removeEventListener('scroll', handleScroll)
      scrollNode.removeEventListener('wheel', handleWheel)
      scrollNode.removeEventListener('touchstart', handleTouchStart)
      scrollNode.removeEventListener('touchmove', handleTouchMove)
      scrollNode.removeEventListener('pointerdown', handlePointerDown)
      scrollNode.removeEventListener('keydown', handleKeyDown)
      scrollNode.removeEventListener('focusout', handleFocusOut)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
    // Refs are stable; dependencies mirror the original effect.
  }, [
    catchUpBlockedContent,
    handleScroll,
    isNestedScrollableTarget,
    syncPinnedState,
    unpinFromUserIntent,
    lastScrollTopRef,
    pointerDownRef,
    lastUserInputAtRef,
    scrollRef,
  ])
}
