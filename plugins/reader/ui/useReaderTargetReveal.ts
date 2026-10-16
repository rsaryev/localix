import { useCallback, useEffect, useRef, type RefObject } from 'react'

import type { ReaderChapter } from '../shared/contracts'
import {
  findReaderTextRange,
  readerFragmentTarget,
  type ReaderPreferences,
  type ReaderTextTarget,
} from './model'
import { readerPageOffsetAtOffset } from './pagination'
import {
  READER_HIGHLIGHT_MS,
  READER_REVEAL_MAX_WAIT_MS,
  READER_REVEAL_SETTLE_MS,
  READER_TARGET_REVEAL_MS,
} from './readerPaneModel'

export interface ReaderPendingFragment {
  chapter: number
  fragment: string
}

/**
 * Scrolls a target into view and focuses it once layout settles, then drives the two reveals
 * built on it: a search or annotation highlight, and a fragment awaiting its chapter.
 */
export function useReaderTargetReveal({
  articleRef,
  scrollRef,
  viewMode,
  chapter,
  highlightTarget,
  loadedChapterIndex,
  pendingFragment,
  clearPendingFragment,
  exactNavigationRef,
}: {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  viewMode: ReaderPreferences['viewMode']
  chapter: ReaderChapter | null
  highlightTarget: ReaderTextTarget | null
  loadedChapterIndex: number
  pendingFragment: ReaderPendingFragment | null
  clearPendingFragment: () => void
  exactNavigationRef: RefObject<ReaderPendingFragment | null>
}) {
  const highlightCleanupRef = useRef<(() => void) | null>(null)
  const revealFocusCleanupRef = useRef<(() => void) | null>(null)

  const revealReaderTarget = useCallback(
    (target: HTMLElement, block: ScrollLogicalPosition = 'center') => {
      revealFocusCleanupRef.current?.()
      const root = articleRef.current
      const origin = globalThis.document.activeElement
      const targetId = target.id
      const targetPath: number[] = []
      let pathNode: HTMLElement | null = target
      while (root && pathNode && pathNode !== root) {
        const parent: HTMLElement | null = pathNode.parentElement
        if (!parent) break
        targetPath.unshift(Array.from(parent.children).indexOf(pathNode))
        pathNode = parent
      }
      const resolveTarget = () => {
        if (target.isConnected && articleRef.current?.contains(target)) return target
        if (targetId) {
          const byId = Array.from(
            articleRef.current?.querySelectorAll<HTMLElement>('[id]') ?? [],
          ).find((element) => element.id === targetId)
          if (byId) return byId
        }
        let current: HTMLElement | null = articleRef.current
        for (const index of targetPath) {
          current = (current?.children.item(index) as HTMLElement | null) ?? null
          if (!current) break
        }
        return current
      }
      const scroller = scrollRef.current
      let settled = false
      let settleTimer = 0
      let maximumTimer = 0
      const observer = new ResizeObserver(() => scheduleFocus())
      const release = () => {
        window.clearTimeout(settleTimer)
        window.clearTimeout(maximumTimer)
        observer.disconnect()
        scroller?.removeEventListener('scroll', scheduleFocus)
        if (revealFocusCleanupRef.current === cancel) revealFocusCleanupRef.current = null
      }
      const focusCurrent = () => {
        const current = resolveTarget()
        if (!current) return false
        const active = globalThis.document.activeElement
        if (
          active &&
          active !== globalThis.document.body &&
          active !== origin &&
          active !== current &&
          !current.contains(active)
        ) {
          cancel()
          return false
        }
        const alreadyFocusable = current.matches('a[href],button,input,textarea,select,[tabindex]')
        if (!alreadyFocusable) current.tabIndex = -1
        current.focus({ preventScroll: true })
        current.classList.add('lx-target-reveal')
        window.setTimeout(
          () => current.classList.remove('lx-target-reveal'),
          READER_TARGET_REVEAL_MS,
        )
        if (!alreadyFocusable) {
          current.addEventListener('blur', () => current.removeAttribute('tabindex'), {
            once: true,
          })
        }
        return true
      }
      const finish = () => {
        if (settled) return
        settled = true
        release()
        focusCurrent()
      }
      function scheduleFocus() {
        if (settled) return
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(finish, READER_REVEAL_SETTLE_MS)
      }
      const cancel = () => {
        settled = true
        release()
      }
      revealFocusCleanupRef.current = cancel
      if (scroller) {
        scroller.addEventListener('scroll', scheduleFocus, { passive: true })
        observer.observe(scroller)
      }
      if (root) observer.observe(root)
      target.scrollIntoView({
        behavior: 'auto',
        block,
      })
      if (scroller && viewMode === 'page') {
        scroller.scrollLeft = readerPageOffsetAtOffset(
          scroller.scrollLeft,
          scroller.scrollWidth,
          scroller.clientWidth,
        )
      }
      scheduleFocus()
      maximumTimer = window.setTimeout(focusCurrent, READER_REVEAL_MAX_WAIT_MS)
    },
    [articleRef, scrollRef, viewMode],
  )

  useEffect(() => () => revealFocusCleanupRef.current?.(), [])

  useEffect(() => {
    highlightCleanupRef.current?.()
    highlightCleanupRef.current = null
    if (!chapter || !highlightTarget || !articleRef.current) return
    const frame = requestAnimationFrame(() => {
      const found = articleRef.current
        ? findReaderTextRange(articleRef.current, highlightTarget)
        : null
      if (!found) return
      const marks: HTMLElement[] = []
      for (const segment of found.segments) {
        if (!segment.node.isConnected) continue
        const range = globalThis.document.createRange()
        range.setStart(segment.node, segment.start)
        range.setEnd(segment.node, segment.end)
        const mark = globalThis.document.createElement('mark')
        mark.className = 'reader-saved-target lx-search-mark'
        range.surroundContents(mark)
        marks.push(mark)
      }
      revealReaderTarget(found.block)
      found.block.classList.add('lx-target-reveal')
      const unwrap = () => {
        for (const mark of marks) {
          const parent = mark.parentNode
          if (!parent) continue
          mark.replaceWith(...mark.childNodes)
          parent.normalize()
        }
      }
      const timer = window.setTimeout(() => {
        unwrap()
        found.block.classList.remove('lx-target-reveal')
      }, READER_HIGHLIGHT_MS)
      highlightCleanupRef.current = () => {
        window.clearTimeout(timer)
        unwrap()
        found.block.classList.remove('lx-target-reveal')
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      highlightCleanupRef.current?.()
      highlightCleanupRef.current = null
    }
  }, [articleRef, chapter, highlightTarget, revealReaderTarget])

  useEffect(() => {
    if (!chapter || pendingFragment === null) return
    if (loadedChapterIndex !== pendingFragment.chapter) return
    let timer = 0
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      const target = pendingFragment.fragment
        ? root
          ? readerFragmentTarget(root, pendingFragment.fragment)
          : null
        : root
      if (target) {
        if (pendingFragment.fragment) {
          exactNavigationRef.current = {
            chapter: pendingFragment.chapter,
            fragment: pendingFragment.fragment,
          }
        }
        revealReaderTarget(target, 'start')
        target.classList.add('lx-target-reveal')
        timer = window.setTimeout(
          () => target.classList.remove('lx-target-reveal'),
          READER_TARGET_REVEAL_MS,
        )
      }
      clearPendingFragment()
    })
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [
    articleRef,
    chapter,
    clearPendingFragment,
    exactNavigationRef,
    loadedChapterIndex,
    pendingFragment,
    revealReaderTarget,
  ])

  return revealReaderTarget
}
