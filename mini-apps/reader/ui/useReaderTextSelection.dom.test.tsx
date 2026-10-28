import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('reader text selection adapter', () => {
  test('anchors a native selection and keeps it while toolbar controls take focus', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useReaderTextSelection } = await import('./useReaderTextSelection')
    const OriginalResizeObserver = globalThis.ResizeObserver
    // The property DESCRIPTOR, not the method: reading `Range.prototype.getClientRects`
    // captures an unbound method, while the descriptor round-trips the original exactly.
    const originalGetClientRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects',
    )

    class TestResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
    // The toolbar is measured by the hook through its own ref, so its size is given to the element
    // by its test id rather than by writing to that ref here.
    const originalRect = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getBoundingClientRect',
    )!
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.getAttribute('data-testid') !== 'toolbar') return originalRect.value.call(this)
      return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 } as DOMRect
    }
    Range.prototype.getClientRects = () =>
      [
        {
          left: 100,
          top: 200,
          right: 200,
          bottom: 220,
          width: 100,
          height: 20,
        },
      ] as unknown as DOMRectList

    function Surface({ active, revision = 0 }: { active: boolean; revision?: number }) {
      const articleRef = React.useRef<HTMLElement>(null)
      const scrollRef = React.useRef<HTMLDivElement>(null)
      const surfaceRef = React.useRef<HTMLElement>(null)
      const selection = useReaderTextSelection({
        articleRef,
        scrollRef,
        surfaceRef,
        contentKey: active ? 'chapter' : null,
      })
      const surfaceRect = {
        left: 0,
        top: 0,
        right: 500,
        bottom: 400,
        width: 500,
        height: 400,
      } as DOMRect
      return (
        <section
          ref={(node) => {
            surfaceRef.current = node
            if (node) node.getBoundingClientRect = () => surfaceRect
          }}
        >
          <div
            ref={(node) => {
              scrollRef.current = node
              if (node) node.getBoundingClientRect = () => surfaceRect
            }}
          >
            {active && (
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stands in for the reading article, which takes the same delegated selection events
              <article
                ref={articleRef}
                onPointerDown={selection.onSelectionPointerDown}
                onPointerUp={selection.onSelectionPointerUp}
                onPointerCancel={selection.onSelectionPointerCancel}
                onKeyUp={selection.onSelectionKeyUp}
              >
                <span key={revision}>Selectable passage</span>
              </article>
            )}
          </div>
          {selection.selectionTarget && (
            <div
              ref={selection.selectionToolbarRef}
              data-testid="toolbar"
              // oxlint-disable-next-line react/refs -- the hook's result holds the toolbar's ref (only attached above), so the rule takes every field of it for a ref read; this one is plain data
              data-visible={selection.selectionToolbarVisible || undefined}
              style={selection.selectionToolbarStyle}
            >
              <button type="button">Copy</button>
              {selection.selection}
            </div>
          )}
        </section>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Surface active={false} />))
      await act(async () => root.render(<Surface active />))
      const text = host.querySelector('article')!.firstChild!.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 10)
      const nativeSelection = window.getSelection()!
      await act(async () => {
        nativeSelection.removeAllRanges()
        nativeSelection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        await turns()
      })

      const toolbar = host.querySelector<HTMLElement>('[data-testid="toolbar"]')!
      expect(toolbar.textContent).toContain('Selectable')
      expect(toolbar.dataset.visible).toBe('true')
      expect(toolbar.style.left).toBe('50px')
      expect(toolbar.style.top).toBe('150px')

      await act(async () => {
        root.render(<Surface active revision={1} />)
        await turns()
      })
      const article = host.querySelector('article')!
      expect(toolbar.dataset.visible).toBe('true')
      expect(toolbar.style.top).toBe('150px')
      expect(nativeSelection.toString()).toBe('Selectable')

      await act(async () => {
        toolbar
          .querySelector('button')!
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        nativeSelection.removeAllRanges()
        toolbar.querySelector('button')!.focus()
        document.dispatchEvent(new Event('selectionchange'))
        await turns()
      })
      expect(host.querySelector('[data-testid="toolbar"]')).not.toBeNull()
      expect(nativeSelection.toString()).toBe('Selectable')
      expect(document.activeElement?.textContent).toBe('Copy')

      await act(async () => {
        const scroller = article.parentElement!
        scroller.scrollTop = 120
        article.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        article.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }))
        await turns()
      })
      expect(host.querySelector('[data-testid="toolbar"]')).toBeNull()
      expect(nativeSelection.toString()).toBe('')
      expect(article.textContent).toBe('Selectable passage')
      expect(article.parentElement?.scrollTop).toBe(120)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      globalThis.ResizeObserver = OriginalResizeObserver
      Object.defineProperty(Element.prototype, 'getBoundingClientRect', originalRect)
      if (originalGetClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', originalGetClientRects)
      } else {
        Reflect.deleteProperty(Range.prototype, 'getClientRects')
      }
    }
  })
})
