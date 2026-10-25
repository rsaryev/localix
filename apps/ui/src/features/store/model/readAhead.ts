/**
 * Reading a listing's page before it is opened, when the pointer RESTS on its card. Scrolling
 * slides cards under a still pointer and fires the same pointer events, so an intent during a
 * scroll, or one a scroll overtakes, reads nothing: opening a page may fetch the package.
 */
export function createReadAhead<T>(deps: {
  delayMs: number
  read: (target: T) => void
  now?: () => number
  setTimer?: (fire: () => void, ms: number) => () => void
}) {
  const now = deps.now ?? Date.now
  const setTimer =
    deps.setTimer ??
    ((fire, ms) => {
      const id = setTimeout(fire, ms)
      return () => clearTimeout(id)
    })
  let lastScroll = -Infinity
  let cancel: (() => void) | null = null
  const leave = () => {
    cancel?.()
    cancel = null
  }
  return {
    /** The pointer reached a card, or it took focus. */
    intent: (target: T) => {
      leave()
      if (now() - lastScroll < deps.delayMs) return
      cancel = setTimer(() => {
        cancel = null
        deps.read(target)
      }, deps.delayMs)
    },
    /** The list moved: whatever waits was a card passing by. */
    scrolled: () => {
      lastScroll = now()
      leave()
    },
    leave,
  }
}
