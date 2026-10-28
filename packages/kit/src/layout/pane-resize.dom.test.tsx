import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'
import { usePaneResize, type PaneResize } from './pane-resize'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

/**
 * A container of a fixed on-screen height. happy-dom has no layout engine, and a real
 * ResizeObserver never fires without one — so the observed size is supplied here, which
 * is the only way to exercise the container clamp at all.
 */
type Observed = { fire: () => void; restore: () => void }

function fakeResizeObserver(): Observed {
  const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  let callback: (() => void) | null = null
  class Fake {
    constructor(cb: () => void) {
      callback = cb
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = Fake
  return {
    fire: () => callback?.(),
    restore: () => {
      ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = original
    },
  }
}

let observed: Observed | null = null

afterEach(() => {
  observed?.restore()
  observed = null
})

/** Mount the hook against a container that reports `height`, returning live handles. */
async function mount(height: number) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')

  observed = fakeResizeObserver()
  const seen: PaneResize[] = []

  function Harness() {
    const ref = React.useRef<HTMLDivElement>(null)
    const pane = usePaneResize({
      axis: 'y',
      initial: 600,
      min: 96,
      max: 600,
      containerRef: ref,
      reserve: 132,
    })
    seen.push(pane)
    return React.createElement(
      'div',
      { ref },
      React.createElement('div', {
        'data-testid': 'pane',
        style: { height: `${pane.size}px` },
      }),
      React.createElement('div', {
        role: 'separator',
        tabIndex: 0,
        onKeyDown: pane.onResizeKeyDown,
        'aria-valuenow': Math.round(pane.size),
        'aria-valuemax': Math.round(pane.limit),
      }),
    )
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(Harness))
  })
  // The container's measured extent, read through getBoundingClientRect by the hook.
  const container = host.firstElementChild as HTMLElement
  container.getBoundingClientRect = () =>
    ({ width: 800, height, top: 0, left: 0, right: 800, bottom: height }) as DOMRect
  await act(async () => observed!.fire())

  return {
    act,
    root,
    host,
    latest: () => seen.at(-1)!,
    separator: () => host.querySelector('[role="separator"]')!,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('usePaneResize — the divider must stay reachable', () => {
  test('measures a conditional container when it appears after data loading', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')

    observed = fakeResizeObserver()
    const seen: PaneResize[] = []

    function Harness({ ready }: { ready: boolean }) {
      const ref = React.useRef<HTMLDivElement>(null)
      const pane = usePaneResize({
        axis: 'x',
        initial: 480,
        min: 320,
        max: 1200,
        containerRef: ref,
        reserve: 320,
        measureKey: ready,
      })
      seen.push(pane)
      return ready ? React.createElement('div', { ref }) : null
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness ready={false} />))
      expect(seen.at(-1)!.limit).toBe(1200)

      await act(async () => root.render(<Harness ready />))
      const container = host.firstElementChild as HTMLElement
      container.getBoundingClientRect = () =>
        ({ width: 666, height: 800, top: 0, left: 0, right: 666, bottom: 800 }) as DOMRect
      await act(async () => observed!.fire())

      expect(seen.at(-1)!.size).toBe(346)
      expect(seen.at(-1)!.limit).toBe(346)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('container observation disconnects while the console work item is parked', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')

    const OriginalResizeObserver = globalThis.ResizeObserver
    let created = 0
    let disconnected = 0
    class CountingResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        created += 1
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected += 1
      }
    }
    globalThis.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver

    function Pane() {
      const ref = React.useRef<HTMLDivElement>(null)
      usePaneResize({
        axis: 'y',
        initial: 300,
        min: 96,
        max: 600,
        containerRef: ref,
        reserve: 132,
      })
      return <div ref={ref} />
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Pane />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(1)

      await act(async () => root.render(<Surface visible={false} />))
      expect(disconnected).toBe(1)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })

  test('a size larger than the container is squeezed to leave the reserve', async () => {
    const h = await mount(400)
    try {
      // 600px asked for, 400px available, 132px reserved for the other half.
      expect(h.latest().size).toBe(268)
      // The separator advertises the live bound, not the static one, so an assistive
      // technology reports a range the user can actually reach.
      expect(h.separator().getAttribute('aria-valuemax')).toBe('268')
    } finally {
      await h.cleanup()
    }
  })

  test('growing the container restores the size the user asked for', async () => {
    const h = await mount(400)
    try {
      expect(h.latest().size).toBe(268)
      const container = h.host.firstElementChild as HTMLElement
      container.getBoundingClientRect = () =>
        ({ width: 800, height: 900, top: 0, left: 0, right: 800, bottom: 900 }) as DOMRect
      await h.act(async () => observed!.fire())
      // Not 268 — the squeeze was a presentation clamp, never a write to the preference.
      expect(h.latest().size).toBe(600)
    } finally {
      await h.cleanup()
    }
  })

  /**
   * `size` is a number the caller renders as an inline style, so it has to live in
   * React state — but pointermove fires above the display's refresh rate, and a
   * render per event is work no frame can ever show. The drag coalesces to one state
   * write per animation frame, carrying the latest position.
   */
  test('a burst of pointermoves costs one render per frame, and lands on the last one', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')

    const originalRaf = globalThis.requestAnimationFrame
    const originalCancel = globalThis.cancelAnimationFrame
    let frames: Array<(() => void) | null> = []
    globalThis.requestAnimationFrame = ((cb: () => void) =>
      frames.push(cb)) as unknown as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => {
      frames[id - 1] = null
    }) as unknown as typeof cancelAnimationFrame
    const flush = async () => {
      const due = frames
      frames = []
      await act(async () => due.forEach((cb) => cb?.()))
    }

    let renders = 0
    const seen: PaneResize[] = []
    function Harness() {
      const pane = usePaneResize({ axis: 'x', initial: 400, min: 100, max: 900 })
      // Every commit is one render here, so counting in an effect needs no write during render.
      React.useEffect(() => {
        renders += 1
      })
      seen.push(pane)
      return (
        <div
          role="separator"
          aria-label="Pane size"
          onPointerDown={pane.onResizeStart}
          style={{ width: `${pane.size}px` }}
        />
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      const sash = host.querySelector('[role="separator"]')!
      await act(async () => {
        sash.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0 }))
      })
      const afterDown = renders

      // Twelve moves inside a single frame.
      for (const dx of [2, 5, 9, 14, 20, 27, 35, 44, 54, 65, 77, 90]) {
        await act(async () =>
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: dx })),
        )
      }
      expect(renders).toBe(afterDown) // nothing committed yet
      expect(seen.at(-1)!.size).toBe(400)

      await flush()
      expect(renders).toBe(afterDown + 1) // one render for the whole burst
      expect(seen.at(-1)!.size).toBe(490) // the LATEST position, not the first

      // A move still pending when the pointer lifts is never dropped.
      await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120 })))
      await act(async () => window.dispatchEvent(new PointerEvent('pointerup', {})))
      expect(seen.at(-1)!.size).toBe(520)
      expect(seen.at(-1)!.resizing).toBe(false)
    } finally {
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancel
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('arrow keys resize, Home/End reach the bounds', async () => {
    const h = await mount(900)
    const press = async (key: string, shiftKey = false) => {
      await h.act(async () => {
        h.separator().dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
        )
      })
    }
    try {
      expect(h.latest().size).toBe(600)
      await press('ArrowUp')
      expect(h.latest().size).toBe(584)
      await press('ArrowUp', true)
      expect(h.latest().size).toBe(520)
      await press('ArrowDown')
      expect(h.latest().size).toBe(536)
      await press('Home')
      expect(h.latest().size).toBe(96)
      await press('End')
      expect(h.latest().size).toBe(600)
      // An unhandled key must not be swallowed — the separator is not a keyboard trap.
      const other = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      h.separator().dispatchEvent(other)
      expect(other.defaultPrevented).toBe(false)
    } finally {
      await h.cleanup()
    }
  })

  test('an inverse divider grows a right-anchored pane toward the left', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const seen: PaneResize[] = []

    function Harness() {
      const pane = usePaneResize({
        axis: 'x',
        direction: -1,
        initial: 276,
        min: 232,
        max: 420,
      })
      seen.push(pane)
      return (
        <div
          role="separator"
          aria-label="Resize right pane"
          tabIndex={0}
          onKeyDown={pane.onResizeKeyDown}
        />
      )
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      const separator = host.querySelector('[role="separator"]')!
      await act(async () => {
        separator.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
        )
      })
      expect(seen.at(-1)!.size).toBe(292)
      await act(async () => {
        separator.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
        )
      })
      expect(seen.at(-1)!.size).toBe(276)
    } finally {
      await act(async () => root.unmount())
    }
  })
})
