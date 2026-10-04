import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

const pluginEditor: FileEditorContribution = {
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
      matches={[pluginEditor]}
      fileKey="/tmp/x.csv"
      fallbackLabel="Code editor"
      requestedBuiltin={props.requestedBuiltin}
      renderFallback={() => <div data-testid="builtin-editor" />}
      editorProps={{ sessionId: 's1', path: '/tmp/x.csv', revealAt: props.revealAt }}
    />
  )
}

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
