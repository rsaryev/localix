import { offerKeyToFocusedSurface } from '@localixai/mini-app-sdk/ui/focus'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { bindMiniAppUiComponents } from '@localixai/mini-app-sdk/ui'
import { problemReportTitle } from '@localixai/mini-app-sdk/ui/problems'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui'

import { readerWorkspaceSelectionKey } from './model'

let teardown: () => Promise<void>
let unbindComponents: (() => void) | undefined

/**
 * The reader renders `ProblemLine`, which the SDK resolves from the HOST-bound component set — in
 * the app that binding happens in `miniAppRuntime.ts`, and a test that never performs it makes the
 * very first render throw "Mini app UI components are not bound by the host". Bound to the same
 * minimal stubs a host binding provides, with `ProblemLine` rendering the real headline so a
 * raw driver message cannot slip onto the surface unnoticed.
 */
function bindHostComponents(): () => void {
  const Empty = () => null
  const Problem = ({ report, actions }: MiniAppProblemLineProps) => (
    <div role="alert">
      <span>{problemReportTitle(report)}</span>
      {/* The ways OUT are the point of this line, and the reader's tests assert on them by
          label — a stub that rendered only "Details" would pass a surface with no exit. */}
      {(actions ?? []).map((action) => (
        <button key={action.id} type="button" onClick={() => void action.run()}>
          {action.label}
        </button>
      ))}
      <button type="button">Details</button>
    </div>
  )
  return bindMiniAppUiComponents({
    FileTab: Empty,
    TableGrid: Empty,
    ContextBindingIcon: Empty,
    ContextBindingPreview: Empty,
    Input: ({ size: _size, ...props }) => <input {...props} />,
    Textarea: (props) => <textarea {...props} />,
    ProblemLine: Problem,
    ProblemState: Problem,
  })
}

const routeKey = (event: KeyboardEvent) => {
  offerKeyToFocusedSurface(event)
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  unbindComponents = bindHostComponents()
  window.addEventListener('keydown', routeKey)
})

afterAll(async () => {
  window.removeEventListener('keydown', routeKey)
  unbindComponents?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const book = {
  path: '/books/persistent.epub',
  title: 'Persistent book',
  format: 'epub' as const,
  size: 128,
  updatedAt: '2026-08-16T00:00:00.000Z',
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ReaderWorkspace tab state', () => {
  test('reopens the selected library book after the work-item body remounts', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ReaderWorkspace } = await import('./ReaderWorkspace')
    const sessionId = 'reader-remount-test'
    const storageKey = readerWorkspaceSelectionKey(sessionId)
    localStorage.removeItem(storageKey)
    const requests: string[] = []
    const unbindTransport = bindMiniAppUiTransport({
      request: async (path) => {
        requests.push(path)
        if (path.startsWith('/rpc/reader/library')) {
          return json({ books: [book], collections: [] })
        }
        if (path.startsWith('/rpc/reader/document')) {
          return json({
            document: {
              path: book.path,
              title: book.title,
              format: book.format,
              wordCount: 2,
              chapters: [{ id: 'chapter-1', index: 0, title: 'Chapter 1', wordCount: 2 }],
            },
          })
        }
        if (path.startsWith('/rpc/reader/chapter')) {
          return json({
            chapter: {
              id: 'chapter-1',
              index: 0,
              title: 'Chapter 1',
              wordCount: 2,
              kind: 'text',
              content: 'Stay open',
              text: 'Stay open',
            },
          })
        }
        return json({})
      },
      url: (path) => path,
    })
    const host = document.createElement('div')
    document.body.append(host)
    let root = createRoot(host)

    try {
      await act(async () => {
        root.render(<ReaderWorkspace sessionId={sessionId} />)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const cover = host.querySelector<HTMLButtonElement>('[data-reader-book-key]')
      expect(cover?.textContent).toContain(book.title)

      await act(async () => {
        cover!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(localStorage.getItem(storageKey)).toBe(JSON.stringify({ path: book.path }))
      expect(
        requests.some((path) => path.includes('/document?path=%2Fbooks%2Fpersistent.epub')),
      ).toBe(true)

      await act(async () => root.unmount())
      host.replaceChildren()
      requests.length = 0
      root = createRoot(host)

      await act(async () => {
        root.render(<ReaderWorkspace sessionId={sessionId} />)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(
        requests.some((path) => path.includes('/document?path=%2Fbooks%2Fpersistent.epub')),
      ).toBe(true)
      expect(host.textContent).toContain('Stay open')

      const toolbar = host.querySelector('[aria-label="Reader controls"]')!
      const path = host.querySelector('[aria-label="Reader path"]')!
      expect(toolbar.contains(path)).toBe(true)
      expect(host.querySelectorAll('[aria-label="Reader path"]')).toHaveLength(1)
      expect(path.querySelector('[aria-label="Switch book"]')).not.toBeNull()
      expect(path.querySelector('[aria-label="Switch chapter"]')).not.toBeNull()
      const primary = isPrimaryModifier({ metaKey: true, ctrlKey: false })
        ? { metaKey: true }
        : { ctrlKey: true }
      const pressFind = (target: Element) => {
        const event = new KeyboardEvent('keydown', {
          key: 'f',
          ...primary,
          bubbles: true,
          cancelable: true,
        })
        target.dispatchEvent(event)
        return event
      }
      expect(pressFind(document.body).defaultPrevented).toBe(false)
      expect(Boolean(host.querySelector('input[aria-label="Search inside book"]'))).toBe(false)
      const readingSurface = host.querySelector('article')!
      await act(async () => {
        expect(pressFind(readingSurface).defaultPrevented).toBe(true)
      })
      expect(Boolean(host.querySelector('input[aria-label="Search inside book"]'))).toBe(true)

      const back = host.querySelector<HTMLButtonElement>('[aria-label="Back to library"]')
      await act(async () => {
        back!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(localStorage.getItem(storageKey)).toBeNull()
      expect(host.querySelector('[aria-label="Book gallery"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      localStorage.removeItem(storageKey)
      unbindTransport()
    }
  })

  test('a non-reading file fails without a round-trip and keeps a way out', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ReaderWorkspace } = await import('./ReaderWorkspace')
    const sessionId = 'reader-unsupported-test'
    const storageKey = readerWorkspaceSelectionKey(sessionId)
    localStorage.removeItem(storageKey)
    const requests: string[] = []
    const unbindTransport = bindMiniAppUiTransport({
      request: async (path) => {
        requests.push(path)
        if (path.startsWith('/rpc/reader/library')) return json({ books: [], collections: [] })
        return json({})
      },
      url: (path) => path,
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <ReaderWorkspace sessionId={sessionId} initialPath="/pictures/screenshot.png" />,
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(requests.some((path) => path.startsWith('/rpc/reader/document'))).toBe(false)
      expect(host.textContent).toContain('Reader cannot open screenshot.png')

      const back = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Back to library'),
      )
      expect(back).toBeDefined()
      await act(async () => {
        back!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      // The failure is an exit, not a trap: the pane lands back on the library.
      expect(host.textContent).not.toContain('Reader cannot open')
      expect(host.textContent).toContain('Open book')
      expect(localStorage.getItem(storageKey)).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      localStorage.removeItem(storageKey)
      unbindTransport()
    }
  })
})
