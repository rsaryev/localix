import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { bottomScrollTop, isViewportScrollable, needsBottomScroll } from './autoScrollGeometry'
import {
  getChatScrollSnapshot,
  isUsableScrollViewport,
  restoredScrollTop,
  saveChatScrollSnapshot,
} from './chatScrollState'

interface SessionRestoreOptions {
  scrollRef: RefObject<HTMLElement | null>
  sessionId: string | null | undefined
  isOpen: boolean
  sessionIdRef: MutableRefObject<string | null | undefined>
  shouldStickToBottomRef: MutableRefObject<boolean>
  restoredUnpinnedUntilRef: MutableRefObject<number>
  autoScrollTargetRef: MutableRefObject<{ top: number; expiresAt: number } | null>
  lastScrollTopRef: MutableRefObject<number>
  blockedContentDirtyRef: MutableRefObject<boolean>
  setShowScrollToBottom: (show: boolean) => void
  autoScrollBlocked: () => boolean
  scrollToBottom: () => void
}

/** Opens a session at its tail and preserves each session's reading position across geometry loss. */
export function useAutoScrollSessionRestore({
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
}: SessionRestoreOptions) {
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
    // Refs and the state setter are stable; dependencies mirror the original effect.
  }, [
    sessionId,
    isOpen,
    autoScrollBlocked,
    scrollToBottom,
    lastScrollTopRef,
    setShowScrollToBottom,
    scrollRef,
    shouldStickToBottomRef,
    autoScrollTargetRef,
    restoredUnpinnedUntilRef,
    blockedContentDirtyRef,
    sessionIdRef,
  ])
}
