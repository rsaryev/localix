import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { miniAppExternal } from '@localixai/mini-app-sdk/ui/runtime'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { readerLinkGesture, readerLinkTarget } from '../shared/link'
import type { ReaderNavigationLocation } from './model'

/** Click and key handling inside the article: links, note references and annotation marks. */
export function useReaderArticleLinks({
  articleRef,
  loadedChapterIndex,
  noteChapter,
  openReaderNote,
  closeNotePopover,
  navigateReader,
  openAnnotationEditor,
  moveParagraphFocus,
}: {
  articleRef: RefObject<HTMLElement | null>
  loadedChapterIndex: number
  /** The chapter the open note popover belongs to, when one is open. */
  noteChapter: number | undefined
  openReaderNote: (anchor: HTMLAnchorElement) => boolean
  closeNotePopover: () => void
  navigateReader: (location: ReaderNavigationLocation) => void
  openAnnotationEditor: (id: string | null) => void
  moveParagraphFocus: (event: ReactKeyboardEvent<HTMLElement>) => boolean
}) {
  const navigateToReaderFragment = (targetChapter: number, fragment: string) => {
    closeNotePopover()
    navigateReader({
      chapter: targetChapter,
      fraction: 0,
      ...(fragment ? { fragment } : {}),
    })
  }

  const openReaderExternal = (href: string) => {
    void Promise.resolve()
      .then(() => miniAppExternal.open(href))
      .catch((cause) => {
        toast.error('Could not open the link', {
          description: errorMessage(cause, '') || undefined,
        })
      })
  }

  const linkTarget = (anchor: HTMLAnchorElement, chapter: number) =>
    readerLinkTarget(
      {
        href: anchor.getAttribute('href'),
        chapter: anchor.dataset.readerChapter,
        fragment: anchor.dataset.readerFragment,
      },
      chapter,
    )

  const activateNoteLink = (anchor: HTMLAnchorElement) => {
    const target = linkTarget(anchor, noteChapter ?? loadedChapterIndex)
    if (target.kind === 'external') {
      closeNotePopover()
      openReaderExternal(target.href)
    } else if (target.kind === 'internal') {
      navigateToReaderFragment(target.chapter, target.fragment)
    }
  }

  const activateArticleAnchor = (anchor: HTMLAnchorElement): boolean => {
    if (openReaderNote(anchor)) return true
    const target = linkTarget(anchor, loadedChapterIndex)
    if (target.kind === 'internal') {
      navigateToReaderFragment(target.chapter, target.fragment)
      return true
    }
    if (target.kind === 'external') {
      openReaderExternal(target.href)
      return true
    }
    return false
  }

  const activateArticleLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (readerLinkGesture(event) !== 'primary') return
    const target = event.target as Element | null
    const annotation = target?.closest<HTMLElement>('[data-reader-annotation-id]')
    if (annotation && articleRef.current?.contains(annotation)) {
      event.preventDefault()
      openAnnotationEditor(annotation.dataset.readerAnnotationId ?? null)
      return
    }
    const anchor = target?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !articleRef.current?.contains(anchor)) return
    if (activateArticleAnchor(anchor)) {
      event.preventDefault()
      // `tauri-plugin-shell` injects a click listener on document.body that fires
      // for any `<a target="_blank">` — which is exactly what the sanitizer puts
      // on a book's external links — and calls `plugin:shell|open` WITHOUT
      // checking `defaultPrevented`. That command is deliberately not in this
      // app's capabilities, so the click also raised a denied invoke. React
      // listens inside body, so stopping here keeps that shim out of a click we
      // have already handled.
      event.stopPropagation()
    }
  }

  const activateArticleAuxLink = (event: ReactMouseEvent<HTMLElement>) => {
    if (readerLinkGesture(event) !== 'auxiliary') return
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || !articleRef.current?.contains(anchor)) return
    if (activateArticleAnchor(anchor)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const activateArticleAnnotationKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (moveParagraphFocus(event)) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    const annotation = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-reader-annotation-id]',
    )
    if (!annotation || !articleRef.current?.contains(annotation)) return
    event.preventDefault()
    openAnnotationEditor(annotation.dataset.readerAnnotationId ?? null)
  }

  return {
    navigateToReaderFragment,
    activateNoteLink,
    activateArticleLink,
    activateArticleAuxLink,
    activateArticleAnnotationKey,
  }
}
