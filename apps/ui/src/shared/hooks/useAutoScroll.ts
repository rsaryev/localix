import { useCallback, useEffect, useRef, useState } from 'react'
import { isUsableScrollViewport, saveChatScrollSnapshot } from './chatScrollState'
import { motionSafeScrollBehavior } from '@localixai/kit/environment'

import {
  BOTTOM_THRESHOLD_PX,
  USER_INPUT_WINDOW_MS,
  atBottom,
  bottomScrollTop,
  needsBottomScroll,
  shouldScheduleBottomReapply,
} from './autoScrollGeometry'
import { useAutoScrollSessionRestore } from './useAutoScrollSessionRestore'
import { useAutoScrollContentObserver } from './useAutoScrollContentObserver'
import { useAutoScrollUserInput } from './useAutoScrollUserInput'

export {
  atBottom,
  bottomScrollTop,
  contentChangeAction,
  isNearBottom,
  needsBottomScroll,
  shouldScheduleBottomReapply,
  type ScrollGeometry,
} from './autoScrollGeometry'

export function useAutoScroll<T extends HTMLElement>(sessionId?: string | null, isOpen = true) {
  const scrollRef = useRef<T | null>(null)
  const sessionIdRef = useRef(sessionId)
  const shouldStickToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const lastUserInputAtRef = useRef(0)
  // True while a pointer is pressed inside the scroll container (covers
  // scrollbar drags, which fire scroll events for as long as the drag lasts).
  const pointerDownRef = useRef(false)
  const bottomReapplyFrameRef = useRef<number | null>(null)
  const restoredUnpinnedUntilRef = useRef(0)
  const blockedContentDirtyRef = useRef(false)
  // Position + time window of our last programmatic scrollTo, so the events it
  // fires aren't mistaken for a user-initiated scroll-up. A counter is unreliable
  // here: scrollTo() to an already-at-bottom position can fire 0-2 'scroll' events,
  // so a fixed reservation leaks across calls and eventually swallows a real
  // user scroll-up. Matching the landing position (within tolerance) is exact.
  const autoScrollTargetRef = useRef<{ top: number; expiresAt: number } | null>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const isNestedScrollableTarget = useCallback((target: EventTarget | null) => {
    return (
      target instanceof HTMLElement &&
      target.closest('[data-scrollable]') !== null &&
      target.closest('[data-scrollable]') !== scrollRef.current
    )
  }, [])

  const autoScrollBlocked = useCallback(() => {
    if (pointerDownRef.current) return true
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !scrollRef.current?.contains(active)) return false
    return active instanceof HTMLIFrameElement || Boolean(active.closest('[data-scrollable]'))
  }, [])

  const saveCurrentSession = useCallback((node: HTMLElement) => {
    const id = sessionIdRef.current
    if (!id) return
    saveChatScrollSnapshot(id, {
      scrollTop: node.scrollTop,
      follow: shouldStickToBottomRef.current,
    })
  }, [])

  const markProgrammaticScroll = useCallback((node: HTMLElement, windowMs = 600) => {
    const top = bottomScrollTop(node.scrollHeight, node.clientHeight)
    autoScrollTargetRef.current = {
      top,
      // Browsers dispatch the resulting 'scroll' event asynchronously; keep the
      // guard live briefly so the follow-up event is still absorbed. Smooth
      // scrolls animate over many frames, so they pass a longer window.
      expiresAt: performance.now() + windowMs,
    }
    return top
  }, [])

  const consumeProgrammaticScroll = useCallback((scrollTop: number) => {
    const target = autoScrollTargetRef.current
    if (!target) return false
    if (performance.now() > target.expiresAt) {
      autoScrollTargetRef.current = null
      return false
    }
    // Landed at (or settling toward) the programmatic target — not a user scroll.
    return Math.abs(scrollTop - target.top) <= BOTTOM_THRESHOLD_PX
  }, [])

  const syncPinnedState = useCallback(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode || !isUsableScrollViewport(scrollNode)) return
    // The hold below is armed only for a SCROLLABLE viewport (see `restore`), so measurement here
    // needs no separate non-overflow branch — `atBottom` owns that clause.
    if (performance.now() < restoredUnpinnedUntilRef.current) {
      shouldStickToBottomRef.current = false
      setShowScrollToBottom(true)
      return
    }
    const pinned = atBottom(scrollNode)
    shouldStickToBottomRef.current = pinned
    setShowScrollToBottom(!pinned)
  }, [])

  /**
   * Unpins immediately on explicit user intent to scroll up (wheel/touch).
   * This is the authoritative un-pin path: during streaming our own scrollTo
   * runs every frame, so scroll-event heuristics alone can mistake a small
   * user wheel-up (within the bottom threshold) for a programmatic scroll and
   * yank the user back down. Input events are never fired by scrollTo, so
   * they can't be confused with our own scrolling.
   */
  const unpinFromUserIntent = useCallback(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode || !isUsableScrollViewport(scrollNode)) return
    // Nothing to unpin from if the content doesn't overflow.
    if (scrollNode.scrollHeight <= scrollNode.clientHeight + 1) return
    autoScrollTargetRef.current = null
    blockedContentDirtyRef.current = false
    shouldStickToBottomRef.current = false
    setShowScrollToBottom(true)
    saveCurrentSession(scrollNode)
  }, [saveCurrentSession])

  const handleScroll = useCallback(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode || !isUsableScrollViewport(scrollNode)) return

    const current = scrollNode.scrollTop
    const userRecent =
      pointerDownRef.current ||
      performance.now() - lastUserInputAtRef.current < USER_INPUT_WINDOW_MS

    // Absorb events fired by our own scrollTo calls so they don't falsely
    // un-pin the sticky state (was the root cause of scroll-up after HITL
    // approve). Never absorb while the user is actively wheeling/dragging —
    // their movement must always be evaluated below.
    if (!userRecent && consumeProgrammaticScroll(current)) {
      lastScrollTopRef.current = current
      saveCurrentSession(scrollNode)
      return
    }

    const movedUp = current < lastScrollTopRef.current - 1
    lastScrollTopRef.current = current

    // Mid-flight frames of our own smooth scrollToBottom: heading down toward a
    // live programmatic target. Don't let syncPinnedState un-pin (and flash the
    // scroll-down button) while the animation is still travelling.
    const target = autoScrollTargetRef.current
    if (!userRecent && !movedUp && target && performance.now() <= target.expiresAt) {
      return
    }

    // A user-driven upward move unpins even inside the near-bottom band —
    // otherwise streaming growth re-pins before they escape the threshold.
    if (movedUp && (userRecent || !atBottom(scrollNode))) {
      shouldStickToBottomRef.current = false
      setShowScrollToBottom(true)
      saveCurrentSession(scrollNode)
      return
    }

    syncPinnedState()
    saveCurrentSession(scrollNode)
  }, [syncPinnedState, consumeProgrammaticScroll, saveCurrentSession])

  /**
   * Follow-PRESERVING scroll to the tail: a no-op while the reader is deliberately up in history.
   *
   * This used to re-pin on its first line, making it identical to `forceScrollToBottom` — two names,
   * one behaviour, and a doc-comment on the other one claiming a distinction that did not exist. The
   * caller that needs it is the HITL ARRIVAL trigger: the prompt renders as `interactionOverlay`
   * inside the composer, so it is on screen at every scroll position, and moving the transcript for
   * it bought no visibility while costing the reader their place.
   *
   * Everything that represents an explicit act — the scroll-to-bottom button, sending a message,
   * resolving a HITL prompt — goes through `forceScrollToBottom` instead.
   */
  const scrollToBottom = useCallback(
    (requestedBehavior: ScrollBehavior = 'auto') => {
      const scrollNode = scrollRef.current
      if (!scrollNode) return
      if (!shouldStickToBottomRef.current) return

      const behavior = motionSafeScrollBehavior(requestedBehavior)

      if (autoScrollBlocked()) {
        blockedContentDirtyRef.current = true
        return
      }

      shouldStickToBottomRef.current = true
      restoredUnpinnedUntilRef.current = 0
      setShowScrollToBottom(false)
      saveCurrentSession(scrollNode)
      if (!isUsableScrollViewport(scrollNode)) return

      const top = markProgrammaticScroll(scrollNode, behavior === 'smooth' ? 1500 : 600)
      if (needsBottomScroll(scrollNode.scrollTop, top)) scrollNode.scrollTo({ top, behavior })

      // One rAF re-apply: callers often scroll the same tick they append content —
      // the synchronous scrollTo uses the pre-render scrollHeight and lands short.
      // Skip for smooth scrolls (an instant re-apply would cancel the animation);
      // once pinned, the content observer re-sticks after any further growth.
      if (!shouldScheduleBottomReapply(behavior, bottomReapplyFrameRef.current !== null)) return
      bottomReapplyFrameRef.current = requestAnimationFrame(() => {
        bottomReapplyFrameRef.current = null
        if (!shouldStickToBottomRef.current) return
        const top = markProgrammaticScroll(scrollNode)
        if (needsBottomScroll(scrollNode.scrollTop, top)) {
          scrollNode.scrollTo({ top, behavior: 'auto' })
        }
      })
    },
    [autoScrollBlocked, markProgrammaticScroll, saveCurrentSession],
  )

  useEffect(
    () => () => {
      if (bottomReapplyFrameRef.current !== null) {
        cancelAnimationFrame(bottomReapplyFrameRef.current)
        bottomReapplyFrameRef.current = null
      }
    },
    [],
  )

  useAutoScrollSessionRestore({
    scrollRef,
    sessionId,
    isOpen,
    sessionIdRef,
    shouldStickToBottomRef,
    restoredUnpinnedUntilRef,
    autoScrollTargetRef,
    lastScrollTopRef,
    blockedContentDirtyRef,
    setShowScrollToBottom,
    autoScrollBlocked,
    scrollToBottom,
  })

  /**
   * Pins and scrolls REGARDLESS of the current follow state — now actually different from
   * `scrollToBottom`, which returns early while unpinned.
   *
   * For explicit acts only: the scroll-to-bottom button (it is only ever visible while unpinned, so a
   * follow-preserving call there would do nothing), sending a message, and resolving a HITL prompt.
   * Session switches go through the open-at-bottom intent instead.
   */
  const forceScrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      // An explicit jump-to-latest supersedes the wheel/touch gesture that made
      // the button appear. Without clearing this short attribution window, the
      // first intermediate frame of a smooth scroll is misread as continued user
      // input and immediately unpins the viewport again.
      lastUserInputAtRef.current = 0
      shouldStickToBottomRef.current = true
      scrollToBottom(behavior)
    },
    [scrollToBottom],
  )

  const catchUpBlockedContent = useCallback(() => {
    if (!blockedContentDirtyRef.current) return
    requestAnimationFrame(() => {
      if (
        !blockedContentDirtyRef.current ||
        !shouldStickToBottomRef.current ||
        autoScrollBlocked()
      ) {
        return
      }
      blockedContentDirtyRef.current = false
      scrollToBottom()
    })
  }, [autoScrollBlocked, scrollToBottom])

  useAutoScrollUserInput({
    scrollRef,
    lastScrollTopRef,
    lastUserInputAtRef,
    pointerDownRef,
    handleScroll,
    syncPinnedState,
    unpinFromUserIntent,
    catchUpBlockedContent,
    isNestedScrollableTarget,
  })

  useAutoScrollContentObserver({
    scrollRef,
    shouldStickToBottomRef,
    blockedContentDirtyRef,
    autoScrollBlocked,
    scrollToBottom,
    syncPinnedState,
    markProgrammaticScroll,
  })

  return {
    scrollRef,
    showScrollToBottom,
    scrollToBottom,
    forceScrollToBottom,
  }
}
