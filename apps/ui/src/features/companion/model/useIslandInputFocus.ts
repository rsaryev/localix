import { useLayoutEffect, type RefObject } from 'react'

/** Focus on reveal, including a lazy composer or an answer fetched after the panel opens. */
export function useIslandInputFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  identity?: string,
) {
  useLayoutEffect(() => {
    if (!active || !ref.current) return
    const host = ref.current
    const focusInput = () => {
      const input = host.querySelector<HTMLElement>(
        'textarea:not(:disabled), input:not(:disabled):not([type="hidden"]):not([type="file"])',
      )
      if (!input) return false
      input.focus({ preventScroll: true })
      return document.activeElement === input
    }
    let focused = focusInput()
    const observer = new MutationObserver(() => {
      if (focusInput()) observer.disconnect()
    })
    if (!focused)
      observer.observe(host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled'],
      })
    // Opening can run during pointerdown, before the browser's default click focus. Complete
    // the handoff on this paint, without waiting for the native reveal to finish.
    const frame = requestAnimationFrame(() => {
      if (!host.contains(document.activeElement)) focused = focusInput()
      if (focused) observer.disconnect()
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ref, active, identity])
}
