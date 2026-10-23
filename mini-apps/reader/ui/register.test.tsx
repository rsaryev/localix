import { expect, test } from 'bun:test'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type {
  FileEditorContribution,
  StatusItemContribution,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import type { DedicatedViewerType } from '@localixai/mini-app-sdk/ui'

import { registerUi } from './register'

test('registers reader work items, links, and ebook editor through the mini app host', () => {
  // A recording host from the SDK, not a hand-rolled literal: the contract owns which registries
  // exist, so adding a seam to it can no longer break a mini app that does not use the seam.
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)

  const workItems = registrations.workItems as WorkItemKindContribution[]
  const editors = registrations.fileEditors as FileEditorContribution[]
  const anchors = registrations.anchors as UiAnchorContribution[]
  const formats = (registrations.fileFormats as Record<string, DedicatedViewerType>[]).flatMap(
    (entries) => Object.keys(entries),
  )
  const editorMatch = editors[0]?.match

  expect(workItems.map((item) => item.kind)).toEqual(['reader:workspace', 'reader:book'])
  expect(editors.map((editor) => editor.id)).toEqual(['reader:book'])
  expect(editors.map((editor) => editor.acceptsMedia === true)).toEqual([true])
  expect(formats).toEqual(['epub', 'mobi', 'azw3', 'fb2', 'cbz'])
  expect(anchors.map((anchor) => anchor.id)).toEqual(['reader:resources'])
  expect(editorMatch?.('/books/guide.markdown')).toBe(true)
  expect(editorMatch?.('/books/guide.html')).toBe(true)
  expect(editorMatch?.('/books/notes.txt')).toBe(true)
  expect(editorMatch?.('/books/comic.cbz')).toBe(true)
  expect(editorMatch?.('/books/manual.pdf')).toBe(true)
  expect(editorMatch?.('/books/novel.mobi')).toBe(true)
  expect(editorMatch?.('/books/novel.azw3')).toBe(true)
  expect(editorMatch?.('/books/cover.png')).toBe(false)

  const items = registrations.statusItems as StatusItemContribution[]
  expect(items.map(({ id, placement }) => ({ id, placement }))).toEqual([
    { id: 'reader:open-book', placement: 'titlebar' },
  ])
})
