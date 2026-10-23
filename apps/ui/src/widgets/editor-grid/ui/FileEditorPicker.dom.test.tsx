import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'

import type { FileEditorContribution } from '@/shared/contrib/fileEditors'
import { ContributedFileBody } from './FileEditorPicker'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const miniAppEditor: FileEditorContribution = {
  id: 'example:table',
  label: 'Table view',
  match: (path: string) => path.endsWith('.csv'),
  Component: () => <div data-testid="plugin-editor" />,
}

// react-dom is loaded INSIDE the test, after registerDom() installed the document —
// a module-scope import would initialize it against the wrong global.
async function mount() {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { root: createRoot(container), container }
}

function body(props: { requestedBuiltin: boolean; revealAt: number }) {
  return (
    <ContributedFileBody
      matches={[miniAppEditor]}
      fileKey="/tmp/x.csv"
      fallbackLabel="Code editor"
      requestedBuiltin={props.requestedBuiltin}
      renderFallback={() => <div data-testid="builtin-editor" />}
      editorProps={{ sessionId: 's1', path: '/tmp/x.csv', revealAt: props.revealAt }}
    />
  )
}

/** A PDF: the preferred built-in viewer and Reader both match. */
const pdfViewer: FileEditorContribution = {
  id: 'example:pdf',
  label: 'PDF viewer',
  match: (path: string) => path.endsWith('.pdf'),
  Component: () => <div data-testid="pdf-viewer" />,
  preferred: true,
}
const reader: FileEditorContribution = {
  id: 'other:book',
  label: 'Reader',
  match: (path: string) => path.endsWith('.pdf'),
  Component: () => <div data-testid="reader-book" />,
}

function pdfBody() {
  return (
    <ContributedFileBody
      matches={[pdfViewer, reader]}
      fileKey="/Downloads/paper.pdf"
      fallbackLabel="Code editor"
      renderFallback={() => <div data-testid="builtin-editor" />}
      editorProps={{ sessionId: 's1', path: '/Downloads/paper.pdf', revealAt: 1 }}
    />
  )
}

describe('a PDF with the built-in viewer and Reader', () => {
  // Picking Reader with "remember" on writes a `.pdf` choice to localStorage. Clear it so no test
  // depends on the order it runs in.
  beforeEach(() => localStorage.clear())

  test('opens in the built-in PDF viewer without a chooser', async () => {
    const { root, container } = await mount()
    await act(async () => root.render(pdfBody()))
    const viewer = container.querySelector('[data-testid="pdf-viewer"]')
    expect(viewer).not.toBeNull()
    expect(container.textContent).not.toContain('Open “paper.pdf” with')
    // Editors fill the pane as `flex-1` children; a plain block under the toolbar collapsed the
    // PDF iframe to its intrinsic height.
    expect(viewer!.parentElement!.className.split(' ')).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'flex-1', 'min-h-0']),
    )
    await act(async () => root.unmount())
  })

  test('Reader stays reachable through Open with…', async () => {
    const { root, container } = await mount()
    await act(async () => root.render(pdfBody()))
    const openWith = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Open with…',
    )
    expect(openWith).toBeDefined()
    await act(async () => openWith!.click())
    const readerChoice = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reader',
    )
    expect(readerChoice).toBeDefined()
    await act(async () => readerChoice!.click())
    expect(container.querySelector('[data-testid="reader-book"]')).not.toBeNull()
    await act(async () => root.unmount())
  })
})

/**
 * The editor pick is per-tab STATE: the initializer runs once per mount, so a tab that is
 * already showing a plugin editor used to swallow every later open request — including the
 * one explicit way a caller can ask for text, `openWith: 'builtin'`. From the outside that
 * was a button that did nothing. A new request is recognisable because every open stamps a
 * fresh `revealAt`.
 */
describe('a re-open that asks for the built-in editor', () => {
  test('wins over the latched plugin pick', async () => {
    const { root, container } = await mount()
    await act(async () => root.render(body({ requestedBuiltin: false, revealAt: 1 })))
    expect(container.querySelector('[data-testid="plugin-editor"]')).not.toBeNull()

    await act(async () => root.render(body({ requestedBuiltin: true, revealAt: 2 })))
    expect(container.querySelector('[data-testid="builtin-editor"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  test('a plain re-open does NOT clobber what is showing', async () => {
    const { root, container } = await mount()
    await act(async () => root.render(body({ requestedBuiltin: false, revealAt: 1 })))
    await act(async () => root.render(body({ requestedBuiltin: false, revealAt: 2 })))
    expect(container.querySelector('[data-testid="plugin-editor"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  test('a stale builtin flag without a new request changes nothing', async () => {
    // `openWith` persists on the tab payload after the request it came from; only a NEW
    // request (a changed revealAt) may act on it, or every unrelated re-render of the tab
    // would keep forcing the text editor back.
    const { root, container } = await mount()
    await act(async () => root.render(body({ requestedBuiltin: false, revealAt: 1 })))
    await act(async () => root.render(body({ requestedBuiltin: true, revealAt: 1 })))
    expect(container.querySelector('[data-testid="plugin-editor"]')).not.toBeNull()
    await act(async () => root.unmount())
  })
})
