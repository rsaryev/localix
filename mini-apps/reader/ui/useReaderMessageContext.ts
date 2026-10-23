import { useEffect } from 'react'
import {
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'

import type { ReaderChapter, ReaderDocument } from '../shared/contracts'
import type { ReaderPreferences } from './model'

/** Offers the open chapter, the visible passage and any selection to the agent's composer. */
export function useReaderMessageContext({
  visible,
  chapter,
  chapterResource,
  document,
  displayBookTitle,
  contextPage,
  viewMode,
  publishMessageContext,
  selection,
  visiblePassage,
}: {
  visible: boolean
  chapter: ReaderChapter | null
  chapterResource: string | null
  document: ReaderDocument | null
  displayBookTitle: string
  contextPage: number
  viewMode: ReaderPreferences['viewMode']
  publishMessageContext: PublishMessageContext | undefined
  selection: string
  visiblePassage: string
}) {
  useEffect(() => {
    if (!visible || !chapter || !chapterResource || !publishMessageContext || !document) return
    const bindings = [
      resourceMessageBindingDraft({
        uri: chapterResource,
        label: `${displayBookTitle} · ${chapter.title}`,
      }),
      ...(visiblePassage
        ? [
            snippetMessageBindingDraft({
              label:
                viewMode === 'page'
                  ? `Visible page ${contextPage} · ${chapter.title}`
                  : `Visible passage · ${chapter.title}`,
              content: visiblePassage,
              language: 'text',
            }),
          ]
        : []),
      ...(selection
        ? [
            snippetMessageBindingDraft({
              label: `Selected passage · ${chapter.title}`,
              content: selection,
              language: 'text',
            }),
          ]
        : []),
    ]
    publishMessageContext({ strategy: 'replace', bindings })
    return () => publishMessageContext(null)
  }, [
    chapter,
    chapterResource,
    document,
    displayBookTitle,
    contextPage,
    viewMode,
    publishMessageContext,
    selection,
    visible,
    visiblePassage,
  ])
}
