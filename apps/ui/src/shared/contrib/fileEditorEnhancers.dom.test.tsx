import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { FileEditorEnhancements } from './FileEditorEnhancements'
import { registerFileEditorEnhancer } from './fileEditorEnhancers'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(node: unknown) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node as React.ReactNode))
  return {
    html: host.innerHTML,
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

/**
 * The enhancer chain wraps the WHOLE file editor in a render callback, so a mistake here does not
 * degrade a badge — it takes the editor down with it, behind a route boundary that names no
 * component. These mount real React for that reason.
 */
describe('file editor enhancer chain', () => {
  test('with nothing claiming the file the editor renders unwrapped', async () => {
    const view = await render(
      <FileEditorEnhancements path="/workspace/plain.txt">
        {(enhancement) => <span data-keys={Object.keys(enhancement).join(',') || 'none'} />}
      </FileEditorEnhancements>,
    )
    try {
      expect(view.html).toContain('data-keys="none"')
    } finally {
      await view.close()
    }
  })

  test('a claiming enhancer hands its contribution to the editor', async () => {
    registerFileEditorEnhancer({
      id: 'fixture:blame',
      miniAppName: 'fixture',
      match: (path) => path.endsWith('.ts'),
      Component: ({ path, render: renderEditor }) =>
        renderEditor({ blameSource: async () => [{ line: 1, summary: path }] }),
    })
    const view = await render(
      <FileEditorEnhancements path="/workspace/app.ts">
        {(enhancement) => <span data-blame={enhancement.blameSource ? 'yes' : 'no'} />}
      </FileEditorEnhancements>,
    )
    try {
      expect(view.html).toContain('data-blame="yes"')
    } finally {
      await view.close()
    }
  })

  test('an enhancer that does not match the path never mounts', async () => {
    // The chain filters by `match` BEFORE mounting, not inside the component. An enhancer that
    // mounted for every file would run its polls and fetches against files it has nothing to say
    // about — the cost is invisible in the UI and real on the wire.
    let mounted = 0
    registerFileEditorEnhancer({
      id: 'fixture:counted',
      miniAppName: 'fixture',
      match: (path) => path.endsWith('.md'),
      Component: ({ render: renderEditor }) => {
        mounted += 1
        return renderEditor({})
      },
    })
    const view = await render(
      <FileEditorEnhancements path="/workspace/app.ts">
        {() => <span data-testid="editor" />}
      </FileEditorEnhancements>,
    )
    try {
      expect(view.html).toContain('data-testid="editor"')
      expect(mounted).toBe(0)
    } finally {
      await view.close()
    }
  })

  test('several enhancers compose, and the innermost wins a shared key', async () => {
    registerFileEditorEnhancer({
      id: 'fixture:outer',
      miniAppName: 'fixture',
      match: (path) => path.endsWith('.css'),
      Component: ({ render: renderEditor }) =>
        renderEditor({ blameSource: async () => null, dirtyDiff: undefined }),
    })
    registerFileEditorEnhancer({
      id: 'fixture:inner',
      miniAppName: 'fixture',
      match: (path) => path.endsWith('.css'),
      Component: ({ render: renderEditor }) => renderEditor({ blameSource: undefined }),
    })
    const view = await render(
      <FileEditorEnhancements path="/workspace/app.css">
        {(enhancement) => (
          <span
            data-has-blame={String('blameSource' in enhancement)}
            data-blame={enhancement.blameSource ? 'yes' : 'no'}
          />
        )}
      </FileEditorEnhancements>,
    )
    try {
      // Both contributed the key; the later registration is nested deeper and merges last, so its
      // explicit `undefined` is the answer the editor gets. Spelling that out here because "last
      // one wins" is the only rule that keeps two mini apps on one file predictable.
      expect(view.html).toContain('data-has-blame="true"')
      expect(view.html).toContain('data-blame="no"')
    } finally {
      await view.close()
    }
  })
})
