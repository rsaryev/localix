import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getChatScrollSnapshot,
  isUsableScrollViewport,
  restoredScrollTop,
  saveChatScrollSnapshot,
} from './chatScrollState'
import { motionSafeScrollBehavior } from '@localixai/kit/environment'

const BOTTOM_THRESHOLD_PX = 80

export function isNearBottom(distanceFromBottom: number, threshold = BOTTOM_THRESHOLD_PX) {
  return distanceFromBottom <= threshold
}

/** Geometry `atBottom` reads — an element, or a plain object in tests. */
export interface ScrollGeometry {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

/**
 * Can this viewport scroll at all? One pixel of overflow cannot (browsers round sub-pixel layout),
 * so the tolerance is part of the question, not a fudge.
 */
export function isViewportScrollable(geometry: Omit<ScrollGeometry, 'scrollTop'>): boolean {
  return geometry.scrollHeight > geometry.clientHeight + 1
}

/**
 * THE one predicate behind BOTH the follow state and the scroll-to-bottom button.
 *
 * A viewport that cannot scroll is AT THE BOTTOM — there is nowhere else to be. The absence of
 * that clause is what put a button on screen with nothing to scroll to, so the predicate opens
 * with `if (scrollHeight <= clientHeight) return true` and the button derives from it.
 *
 * Deriving the button from the SAME call that decides following is the other half: the two used to be
 * written from five sites independently, and the restore path set the button before measuring
 * anything.
 */
export function atBottom(geometry: ScrollGeometry, threshold = BOTTOM_THRESHOLD_PX): boolean {
  if (!isViewportScrollable(geometry)) return true
  return isNearBottom(geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight, threshold)
}

export function bottomScrollTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight)
}

export function needsBottomScroll(scrollTop: number, targetTop: number): boolean {
  return Math.abs(scrollTop - targetTop) >= 2
}

export function shouldScheduleBottomReapply(
  behavior: ScrollBehavior,
  framePending: boolean,
): boolean {
  return behavior !== 'smooth' && !framePending
}

type ContentChangeAction = 'scroll-now' | 'schedule-frame' | 'none'

export function contentChangeAction(
  pinned: boolean,
  blocked: boolean,
  framePending: boolean,
): ContentChangeAction {
  // Content growth must never infer that an explicitly-unpinned reader wants to
  // follow again. In particular, a small streamed delta can leave them inside
  // the 80px near-bottom band; scheduling `syncPinnedState` here would re-pin on
  // the very next frame and yank their wheel/selection back to the live tail.
  if (!pinned) return 'none'
  if (pinned && !blocked) return 'scroll-now'
  return framePending ? 'none' : 'schedule-frame'
}

// How long after a wheel/touch input scroll events are attributed to the user
// (and therefore bypass the programmatic-scroll guard below).
const USER_INPUT_WINDOW_MS = 200

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
  /**
   * "This session was just OPENED (or switched to) — land at the live tail."
   *
   * Kept as pending INTENT rather than acted on immediately because a chat can be opened into a
   * viewport with no geometry yet (a warm tab that is still hidden); the intent survives until the
   * viewport can honour it.
   *
   * It deliberately outranks the saved snapshot: opening or switching a session should land at
   * the live tail, and reopening mid-history was the
   * reported "the chat doesn't open at the end". The snapshot still owns the OTHER case — the same
   * session's viewport losing and regaining geometry (a warm tab hidden, then shown again), where the
   * reader never left and their position must survive.
   */
  const openAtBottomPendingRef = useRef(true)
  const openedSessionRef = useRef<string | null | undefined>(undefined)
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

  // A chat body can remain mounted while hidden, or be evicted from the warm
  // cache and remounted later. Preserve its own reading position/follow mode in
  // both cases and restore only after the viewport has non-zero geometry.
  useEffect(() => {
    sessionIdRef.current = sessionId
    if (!isOpen) return
    // Focus can leave a still-visible chat when an action opens a neighboring board. Returning
    // focus is not navigation: preserve the fragment the person was reading. A new session or
    // a newly mounted body still opens at the tail, even before geometry arrives.
    if (openedSessionRef.current !== sessionId) {
      openAtBottomPendingRef.current = true
      openedSessionRef.current = sessionId
    }
    const scrollNode = scrollRef.current
    if (!scrollNode || !sessionId) return

    const boundSessionId = sessionId
    let wasUsable = isUsableScrollViewport(scrollNode)
    let restorePending = Boolean(getChatScrollSnapshot(boundSessionId))
    let openingReapplyFrame: number | null = null

    const scheduleOpeningReapply = () => {
      if (openingReapplyFrame !== null) return
      openingReapplyFrame = requestAnimationFrame(() => {
        openingReapplyFrame = null
        // The transcript virtualizer may publish its measured height one commit
        // after the session switch. Re-apply only while the reader is still in
        // follow mode, so a wheel/touch scroll during that frame always wins.
        if (sessionIdRef.current !== boundSessionId || !shouldStickToBottomRef.current) return
        if (!isUsableScrollViewport(scrollNode)) return
        const top = bottomScrollTop(scrollNode.scrollHeight, scrollNode.clientHeight)
        lastScrollTopRef.current = top
        if (needsBottomScroll(scrollNode.scrollTop, top)) {
          scrollNode.scrollTo({ top, behavior: 'auto' })
        }
      })
    }

    /** Honour a pending open by landing on the tail. Returns false when there was no intent. */
    const openAtBottom = () => {
      if (!openAtBottomPendingRef.current) return false
      if (!isUsableScrollViewport(scrollNode)) return false
      openAtBottomPendingRef.current = false
      // Drop the snapshot so a later geometry blip cannot re-apply the position we just overrode.
      getChatScrollSnapshot(boundSessionId)
      restorePending = false
      shouldStickToBottomRef.current = true
      restoredUnpinnedUntilRef.current = 0
      autoScrollTargetRef.current = null
      const top = bottomScrollTop(scrollNode.scrollHeight, scrollNode.clientHeight)
      lastScrollTopRef.current = top
      setShowScrollToBottom(false)
      if (needsBottomScroll(scrollNode.scrollTop, top))
        scrollNode.scrollTo({ top, behavior: 'auto' })
      scheduleOpeningReapply()
      return true
    }

    const restore = () => {
      if (openAtBottom()) return
      if (!isUsableScrollViewport(scrollNode)) return
      const snapshot = getChatScrollSnapshot(boundSessionId)
      if (!snapshot) return
      // A restored UNPINNED position is only meaningful while the viewport can scroll. A warm tab that
      // regains a viewport too short to scroll has nowhere to be but the bottom, so arming the hold
      // (and the button) there would put a control on screen with nothing to do — the reported
      // "button shows when it isn't needed", in the one path the open-at-bottom intent does not cover.
      const scrollable = isViewportScrollable(scrollNode)
      const followRestored = snapshot.follow || !scrollable
      shouldStickToBottomRef.current = followRestored
      restoredUnpinnedUntilRef.current = followRestored ? 0 : performance.now() + 1_500
      autoScrollTargetRef.current = null
      const top = restoredScrollTop({ ...snapshot, follow: followRestored }, scrollNode)
      lastScrollTopRef.current = top
      setShowScrollToBottom(!followRestored)
      // Restoration is a round-trip, not an auto-scroll heuristic: retain
      // fractional offsets too instead of accepting a visible sub-pixel drift.
      if (scrollNode.scrollTop !== top) {
        scrollNode.scrollTo({ top, behavior: 'auto' })
      }
      restorePending = false
    }

    // Not gated on `restorePending`: a session with no snapshot at all still has to land on its tail.
    if (wasUsable) restore()

    const viewportObserver = new ResizeObserver(() => {
      const usable = isUsableScrollViewport(scrollNode)
      if (!usable) {
        if (wasUsable) {
          saveChatScrollSnapshot(boundSessionId, {
            scrollTop: lastScrollTopRef.current,
            follow: shouldStickToBottomRef.current,
          })
          restorePending = true
        }
        wasUsable = false
        return
      }
      if (!wasUsable || restorePending) {
        restore()
      } else if (shouldStickToBottomRef.current) {
        // A usable viewport can resize without changing the transcript child's
        // box (a taller composer, find bar, panel split, or window resize). Its
        // new bottom therefore produces no content-observer callback. Keep an
        // already-following reader at the tail; explicit scroll-up still wins.
        if (autoScrollBlocked()) blockedContentDirtyRef.current = true
        else scrollToBottom()
      }
      wasUsable = true
    })
    viewportObserver.observe(scrollNode)

    return () => {
      viewportObserver.disconnect()
      if (openingReapplyFrame !== null) cancelAnimationFrame(openingReapplyFrame)
      saveChatScrollSnapshot(boundSessionId, {
        // Never read the shared DOM node here. On a session-id change React may
        // already have committed the incoming transcript into this viewport, and
        // the browser may have clamped its scrollTop to the new geometry. The ref
        // is the last position observed while this effect still owned the outgoing
        // session, so it cannot overwrite that session with the incoming one's
        // clamped offset.
        scrollTop: lastScrollTopRef.current,
        follow: shouldStickToBottomRef.current,
      })
    }
  }, [sessionId, isOpen, autoScrollBlocked, scrollToBottom])

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
      if (
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        (event.key === ' ' && event.shiftKey)
      ) {
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
  }, [
    catchUpBlockedContent,
    handleScroll,
    isNestedScrollableTarget,
    syncPinnedState,
    unpinFromUserIntent,
  ])

  useEffect(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode) return

    // Coalesce bursts of content changes into a single rAF tick.
    let rafId: number | null = null

    const handleContentChange = () => {
      ensureContentObserved()
      const viewport = scrollRef.current
      if (!viewport || !isUsableScrollViewport(viewport)) return

      const action = contentChangeAction(
        shouldStickToBottomRef.current,
        autoScrollBlocked(),
        rafId !== null,
      )

      // Same-frame re-pin: a ResizeObserver callback runs AFTER layout but BEFORE
      // paint, so correcting scrollTop here lands in the same frame the row's new
      // height was applied. Deferring it to the rAF below let the browser paint one
      // mispositioned frame first — which, multiplied across the dozens of row
      // measurements a virtualized list does on open, is the "chat jitters for a
      // few seconds then settles" flicker. Only while pinned + not blocked.
      if (action === 'scroll-now') {
        blockedContentDirtyRef.current = false
        const node = scrollRef.current
        if (node && isUsableScrollViewport(node)) {
          const top = markProgrammaticScroll(node)
          if (needsBottomScroll(node.scrollTop, top)) {
            node.scrollTo({ top, behavior: 'auto' })
          }
        }
        // ResizeObserver runs after layout and before paint, so this write already
        // lands in the target frame. A second rAF scroll only repeats layout work.
        return
      }

      if (action === 'none') return
      blockedContentDirtyRef.current = true
      rafId = requestAnimationFrame(() => {
        rafId = null
        const node = scrollRef.current
        if (!node || !isUsableScrollViewport(node)) return
        if (autoScrollBlocked()) return
        blockedContentDirtyRef.current = false
        if (shouldStickToBottomRef.current) {
          scrollToBottom()
        } else {
          syncPinnedState()
        }
      })
    }

    // Watch only the direct content child for SIZE changes — the virtual list
    // container whose height TanStack Virtual updates as it measures new rows.
    // Watching subtree+characterData fires on every streamed character delta,
    // creating a runaway MutationObserver → setState → re-render loop.
    const resizeObserver = new ResizeObserver(handleContentChange)
    let observedChild: Element | null = null
    const ensureContentObserved = () => {
      const child = scrollNode.firstElementChild
      if (child === observedChild) return
      if (observedChild) resizeObserver.unobserve(observedChild)
      if (child instanceof HTMLElement) {
        resizeObserver.observe(child)
        observedChild = child
      } else {
        observedChild = null
      }
    }
    ensureContentObserved()

    // MutationObserver only for direct childList — NOT subtree/characterData.
    const mutationObserver = new MutationObserver(handleContentChange)
    mutationObserver.observe(scrollNode, { childList: true })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [autoScrollBlocked, scrollToBottom, syncPinnedState, markProgrammaticScroll])

  return {
    scrollRef,
    showScrollToBottom,
    scrollToBottom,
    forceScrollToBottom,
  }
}
