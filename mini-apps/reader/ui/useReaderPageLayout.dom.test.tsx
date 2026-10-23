import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('reader page layout adapter', () => {
  test('retains resize position across observer bursts until the next frame', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useReaderPageLayout } = await import('./useReaderPageLayout')
    const OriginalResizeObserver = globalThis.ResizeObserver
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    const observers: ResizeObserverCallback[] = []
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    let viewportWidth = 600
    let contentWidth = 6_000

    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observers.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = (callback) => {
      const id = ++frameId
      frames.set(id, callback)
      return id
    }
    globalThis.cancelAnimationFrame = (id) => frames.delete(id)

    const positions: Array<{ current: number; total: number }> = []
    function Surface() {
      const articleRef = React.useRef<HTMLElement>(null)
      const scrollRef = React.useRef<HTMLDivElement>(null)
      const requestedFractionRef = React.useRef<number | null>(null)
      useReaderPageLayout({
        articleRef,
        scrollRef,
        contentKey: 'book:chapter',
        layoutKey: 'default',
        viewMode: 'page',
        requestedFractionRef,
        onPagePositionChange: (position) => positions.push(position),
      })
      return (
        <div
          ref={(node) => {
            scrollRef.current = node
            if (!node) return
            Object.defineProperties(node, {
              clientWidth: { configurable: true, get: () => viewportWidth },
              clientHeight: { configurable: true, get: () => 800 },
              scrollWidth: { configurable: true, get: () => contentWidth },
              scrollHeight: { configurable: true, get: () => 800 },
            })
            node.scrollLeft = 600
          }}
        >
          <article ref={articleRef} />
        </div>
      )
    }

    const flushFrames = () => {
      while (frames.size) {
        const batch = Array.from(frames.values())
        frames.clear()
        for (const callback of batch) callback(performance.now())
      }
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Surface />))
      await act(async () => flushFrames())
      expect(observers).toHaveLength(1)

      viewportWidth = 320
      contentWidth = 8_320
      observers[0]!([], {} as ResizeObserver)
      observers[0]!([], {} as ResizeObserver)
      await act(async () => flushFrames())

      const scroller = host.querySelector('div')!
      expect(scroller.scrollLeft).toBe(960)
      expect(scroller.scrollLeft % viewportWidth).toBe(0)
      expect(positions.at(-1)).toEqual({ current: 4, total: 26 })
    } finally {
      await act(async () => root.unmount())
      host.remove()
      globalThis.ResizeObserver = OriginalResizeObserver
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })
})
