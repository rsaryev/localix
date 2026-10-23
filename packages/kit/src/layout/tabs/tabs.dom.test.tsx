import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../../testing/dom'
import { TabBar, TabStrip } from './tabs'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

describe('TabBar visibility', () => {
  // A 300px viewport over three 200px tabs: 600px of content, 300px of scroll room.
  const VIEWPORT = 300
  const TAB_WIDTH = 200
  const MAX_SCROLL = 3 * TAB_WIDTH - VIEWPORT

  test('reveals the active tab when its container resizes', async () => {
    const { createRoot } = await import('react-dom/client')
    const resizeCallbacks: ResizeObserverCallback[] = []
    const OriginalResizeObserver = globalThis.ResizeObserver
    // happy-dom defines getBoundingClientRect on Element.prototype, so we shadow it
    // with an own property here and delete that again to restore. Reading through an
    // index-signature view also keeps the capture off the typed class method.
    const elementProto = HTMLElement.prototype as unknown as Record<string, unknown>
    const callThrough = elementProto.getBoundingClientRect as (this: HTMLElement) => DOMRect
    const labels = ['Tools', 'MCP', 'Plugins']

    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    globalThis.ResizeObserver = TestResizeObserver

    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <TabBar
            aria-label="Settings sections"
            items={[
              { id: 'tools', label: 'Tools' },
              { id: 'mcp', label: 'MCP' },
              { id: 'plugins', label: 'Plugins' },
            ]}
            active="plugins"
            onChange={() => {}}
          />,
        )
      })

      // Give the rendered row the geometry of an overflowing strip. Rects are
      // derived from the live scrollLeft so the numbers stay self-consistent.
      const list = container.querySelector<HTMLElement>('[role="tablist"]')!
      let scrollLeft = 0
      Object.defineProperty(list, 'clientWidth', { configurable: true, get: () => VIEWPORT })
      Object.defineProperty(list, 'scrollWidth', {
        configurable: true,
        get: () => labels.length * TAB_WIDTH,
      })
      Object.defineProperty(list, 'scrollLeft', {
        configurable: true,
        get: () => scrollLeft,
        set: (next: number) => {
          scrollLeft = next
        },
      })
      elementProto.getBoundingClientRect = function (this: HTMLElement) {
        const rect = (left: number, width: number) =>
          ({
            left,
            width,
            right: left + width,
            top: 0,
            bottom: 32,
            height: 32,
            x: left,
            y: 0,
          }) as DOMRect
        if (this === list) return rect(0, VIEWPORT)
        const index = labels.indexOf(this.textContent ?? '')
        if (this.getAttribute('role') === 'tab' && index >= 0)
          return rect(index * TAB_WIDTH - scrollLeft, TAB_WIDTH)
        return callThrough.call(this)
      }

      await act(async () => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver)
        }
      })

      // The last tab is revealed by scrolling THIS strip — and only this strip —
      // to its clamped maximum, so nothing of it stays clipped under the chevron.
      expect(scrollLeft).toBe(MAX_SCROLL)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
      delete elementProto.getBoundingClientRect
    }
  })
})

describe('TabBar trailing slot', () => {
  test('renders the control inside the row but outside the tablist', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          <TabBar
            aria-label="Request configuration"
            items={[
              { id: 'params', label: 'Params' },
              { id: 'body', label: 'Body' },
            ]}
            active="body"
            onChange={() => {}}
            trailing={<button type="button">Body type</button>}
          />,
        )
      })

      const row = container.querySelector<HTMLElement>('[data-slot="tab-bar"]')
      const tablist = container.querySelector<HTMLElement>('[role="tablist"]')
      const trailing = container.querySelector<HTMLElement>('[data-slot="tab-bar-trailing"]')

      // Inside the row → the primitive's single seam runs under both.
      expect(row?.contains(trailing ?? null)).toBe(true)
      // Outside the tablist → the control is not announced as a tab.
      expect(tablist?.contains(trailing ?? null)).toBe(false)
      expect(tablist?.getAttribute('aria-label')).toBe('Request configuration')
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('omits the slot entirely when there is no trailing control', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          <TabBar
            aria-label="Settings sections"
            items={[{ id: 'general', label: 'General' }]}
            active="general"
            onChange={() => {}}
          />,
        )
      })
      expect(container.querySelector('[data-slot="tab-bar-trailing"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('TabStrip overflow observation', () => {
  test('keeps fixed actions outside the tablist', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          <TabStrip
            aria-label="Editor tabs"
            actionsLabel="Editor tab actions"
            actions={<button type="button">New terminal</button>}
            items={[{ id: 'terminal', label: 'Terminal' }]}
            activeId="terminal"
            onChange={() => {}}
          />,
        )
      })

      const tablist = container.querySelector<HTMLElement>('[role="tablist"]')
      const actions = container.querySelector<HTMLElement>('[data-slot="tab-strip-actions"]')
      expect(actions?.getAttribute('aria-label')).toBe('Editor tab actions')
      expect(tablist?.contains(actions ?? null)).toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('only observes layout when an overflow affordance needs measurements', async () => {
    const { createRoot } = await import('react-dom/client')
    const OriginalResizeObserver = globalThis.ResizeObserver
    let observers = 0
    let disconnects = 0

    class TestResizeObserver implements ResizeObserver {
      constructor() {
        observers += 1
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects += 1
      }
    }

    globalThis.ResizeObserver = TestResizeObserver
    const container = document.createElement('div')
    const root = createRoot(container)
    const props = {
      'aria-label': 'Preview tabs',
      items: [{ id: 'preview', label: 'Preview' }],
      activeId: 'preview',
      onChange: () => {},
    }

    try {
      await act(async () => root.render(<TabStrip {...props} />))
      expect(observers).toBe(0)

      await act(async () => root.render(<TabStrip {...props} edgeFade />))
      expect(observers).toBe(1)

      await act(async () => root.render(<TabStrip {...props} />))
      expect(disconnects).toBe(1)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })
})
