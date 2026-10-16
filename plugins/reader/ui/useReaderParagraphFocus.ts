import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'

import type { ReaderChapter } from '../shared/contracts'
import { readerNearestFocusBlock, type ReaderPreferences } from './model'
import { isReaderListKey, readerListKeyIndex } from './readerPaneModel'
import { readerMotionSafeScrollBehavior } from './readerSources'

const FOCUS_BLOCK_SELECTOR = 'h1,h2,h3,h4,p,li,blockquote,pre,figcaption,td,th'

/** Paragraph focus mode: one roving-tabindex block, following the viewport or the arrow keys. */
export function useReaderParagraphFocus({
  articleRef,
  scrollRef,
  chapter,
  focusMode,
}: {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  chapter: ReaderChapter | null
  focusMode: ReaderPreferences['focusMode']
}) {
  const paragraphFocusFrameRef = useRef(0)
  const paragraphFocusBlocksRef = useRef<HTMLElement[]>([])

  const activateParagraphFocus = useCallback((block: HTMLElement | null, moveFocus = false) => {
    if (!block) return
    for (const candidate of paragraphFocusBlocksRef.current) {
      const active = candidate === block
      candidate.tabIndex = active ? 0 : -1
      if (active) {
        candidate.dataset.readerFocusActive = 'true'
      } else {
        delete candidate.dataset.readerFocusActive
      }
    }
    if (!moveFocus) return
    block.focus({ preventScroll: true })
    block.scrollIntoView({
      block: 'center',
      behavior: readerMotionSafeScrollBehavior('smooth'),
    })
  }, [])

  const syncParagraphFocus = useCallback(() => {
    if (focusMode !== 'paragraph') return
    cancelAnimationFrame(paragraphFocusFrameRef.current)
    paragraphFocusFrameRef.current = requestAnimationFrame(() => {
      const blocks = paragraphFocusBlocksRef.current
      const scroller = scrollRef.current
      if (!blocks.length || !scroller) return
      const focused = globalThis.document.activeElement?.closest<HTMLElement>(
        '[data-reader-focus-target="true"]',
      )
      if (focused && articleRef.current?.contains(focused)) return
      const viewport = scroller.getBoundingClientRect()
      const index = readerNearestFocusBlock(
        blocks.map((block) => block.getBoundingClientRect()),
        viewport.top,
        viewport.bottom,
      )
      activateParagraphFocus(blocks[index] ?? null)
    })
  }, [activateParagraphFocus, articleRef, focusMode, scrollRef])

  useEffect(() => {
    const article = articleRef.current
    if (!article || focusMode !== 'paragraph') return
    const candidates = Array.from(article.querySelectorAll<HTMLElement>(FOCUS_BLOCK_SELECTOR))
    const blocks = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
    )
    paragraphFocusBlocksRef.current = blocks
    for (const block of blocks) {
      block.tabIndex = -1
      block.dataset.readerFocusTarget = 'true'
    }
    syncParagraphFocus()
    const listeners = blocks.map((block) => {
      const activate = () => activateParagraphFocus(block)
      block.addEventListener('focus', activate)
      block.addEventListener('click', activate)
      return { block, activate }
    })
    return () => {
      cancelAnimationFrame(paragraphFocusFrameRef.current)
      paragraphFocusBlocksRef.current = []
      for (const { block, activate } of listeners) {
        block.removeEventListener('focus', activate)
        block.removeEventListener('click', activate)
        if (block.dataset.readerFocusTarget !== 'true') continue
        block.removeAttribute('tabindex')
        delete block.dataset.readerFocusTarget
        delete block.dataset.readerFocusActive
      }
    }
  }, [activateParagraphFocus, articleRef, chapter, focusMode, syncParagraphFocus])

  /** Moves between focus blocks on a list key; true when the key was consumed. */
  const moveParagraphFocus = (event: ReactKeyboardEvent<HTMLElement>): boolean => {
    if (focusMode !== 'paragraph' || !isReaderListKey(event.key)) return false
    const current = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-reader-focus-target="true"]',
    )
    const blocks = paragraphFocusBlocksRef.current
    const currentIndex = current ? blocks.indexOf(current) : -1
    if (currentIndex < 0) return false
    event.preventDefault()
    const nextIndex = readerListKeyIndex(event.key, currentIndex, blocks.length)
    activateParagraphFocus(blocks[nextIndex] ?? null, true)
    return true
  }

  return { syncParagraphFocus, moveParagraphFocus }
}
