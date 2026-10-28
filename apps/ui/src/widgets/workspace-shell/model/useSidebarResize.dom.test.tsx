import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { SIDEBAR_WIDTH_VAR, useSidebarResize, type SidebarResize } from './useSidebarResize'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** The painted width as the real shell sets it: through the CSS variable the sidebar reads. */
const widthStyle = (px: number) =>
  ({ [SIDEBAR_WIDTH_VAR]: `${px}px`, width: `var(${SIDEBAR_WIDTH_VAR})` }) as React.CSSProperties

/**
 * Mount the hook against the two elements the real shell gives it: the sidebar panel
 * (whose `--sidebar-width` the browser paints) and the sash (whose ARIA value a
 * screen reader announces). `renders` counts how many times the consuming component
 * ran — that is the cost the drag used to pay 60–120×/s.
 */
async function mount() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')

  let renders = 0
  const seen: SidebarResize[] = []

  function Shell() {
    const sidebar = useSidebarResize()
    const { panelRef, sashRef, sidebarWidth, min, max } = sidebar
    // Count commits, not render passes: one entry per screen the user could have seen.
    React.useEffect(() => {
      renders += 1
      seen.push(sidebar)
    })
    return (
      <div ref={panelRef} data-testid="panel" style={widthStyle(sidebarWidth)}>
        <div
          ref={sashRef}
          role="separator"
          tabIndex={0}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={sidebarWidth}
          aria-valuetext={`${Math.round(sidebarWidth)} pixels`}
          onMouseDown={sidebar.onResizeStart}
          onKeyDown={sidebar.onResizeKeyDown}
          onDoubleClick={sidebar.resetWidth}
        />
      </div>
    )
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Shell />))

  const panel = () => host.querySelector<HTMLElement>('[data-testid="panel"]')!
  const sash = () => host.querySelector<HTMLElement>('[role="separator"]')!
  return {
    act,
    renders: () => renders,
    latest: () => seen.at(-1)!,
    panel,
    sash,
    paintedWidth: () => panel().style.getPropertyValue(SIDEBAR_WIDTH_VAR),
    announcedWidth: () => sash().getAttribute('aria-valuenow'),
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('useSidebarResize — the drag repaints without re-rendering the shell', () => {
  test('a whole drag costs two renders, and the width still tracks the cursor', async () => {
    const h = await mount()
    try {
      const start = h.latest().sidebarWidth
      expect(h.paintedWidth()).toBe(`${start}px`)

      await h.act(async () => {
        h.sash().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
      })
      // One render for `resizing` (it suspends the width transition + lights the sash).
      const afterDown = h.renders()
      expect(h.latest().resizing).toBe(true)

      for (const dx of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        await h.act(async () => {
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + dx }))
        })
        // The paint follows the cursor 1:1 — through the DOM, not through React.
        expect(h.paintedWidth()).toBe(`${start + dx}px`)
      }
      expect(h.renders()).toBe(afterDown) // ten mousemoves, zero renders

      await h.act(async () => window.dispatchEvent(new MouseEvent('mouseup')))
      expect(h.latest().resizing).toBe(false)
      // Committed to React state exactly once, at the end.
      expect(h.latest().sidebarWidth).toBe(start + 10)
      expect(h.paintedWidth()).toBe(`${start + 10}px`)
      expect(h.renders()).toBe(afterDown + 1)
    } finally {
      await h.cleanup()
    }
  })

  test('the sash announces the live width on every mousemove, not just at the end', async () => {
    const h = await mount()
    try {
      const start = h.latest().sidebarWidth
      expect(h.announcedWidth()).toBe(String(start))

      await h.act(async () => {
        h.sash().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }))
      })
      for (const dx of [4, 9, 15, 22]) {
        await h.act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: dx })))
        // aria-valuenow and aria-valuetext are written straight to the sash, so an
        // assistive technology never reads a width that is no longer on screen.
        expect(h.announcedWidth()).toBe(String(start + dx))
        expect(h.sash().getAttribute('aria-valuetext')).toBe(`${start + dx} pixels`)
      }
      await h.act(async () => window.dispatchEvent(new MouseEvent('mouseup')))
      expect(h.announcedWidth()).toBe(String(start + 22))
      expect(h.latest().sidebarWidth).toBe(start + 22)
    } finally {
      await h.cleanup()
    }
  })

  test('a re-render mid-drag does not snap the sidebar back to the committed width', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')

    let sidebar!: SidebarResize
    function Shell({ tick }: { tick: number }) {
      const current = useSidebarResize()
      const { panelRef, sashRef, sidebarWidth, onResizeStart } = current
      React.useEffect(() => {
        sidebar = current
      })
      return (
        <div ref={panelRef} data-tick={tick} style={widthStyle(sidebarWidth)}>
          <div
            ref={sashRef}
            role="separator"
            tabIndex={0}
            aria-label="Resize sidebar"
            aria-valuenow={sidebarWidth}
            onMouseDown={onResizeStart}
          />
        </div>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Shell tick={0} />))
      const start = sidebar.sidebarWidth
      const panel = () => host.querySelector<HTMLElement>('[data-tick]')!

      await act(async () => {
        host
          .querySelector('[role="separator"]')!
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }))
      })
      await act(async () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 })))
      expect(panel().style.getPropertyValue(SIDEBAR_WIDTH_VAR)).toBe(`${start + 30}px`)

      // The shell re-renders for a reason of its own (a streaming chat, a rail badge)
      // while the drag is still in flight. React would repaint the stale committed
      // width; the layout effect re-asserts the live one before the browser paints.
      await act(async () => root.render(<Shell tick={1} />))
      expect(panel().style.getPropertyValue(SIDEBAR_WIDTH_VAR)).toBe(`${start + 30}px`)

      await act(async () => window.dispatchEvent(new MouseEvent('mouseup')))
      expect(sidebar.sidebarWidth).toBe(start + 30)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keyboard, reset and the clamp are unchanged', async () => {
    const h = await mount()
    const press = async (key: string, shiftKey = false) => {
      await h.act(async () => {
        h.sash().dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
        )
      })
    }
    try {
      const start = h.latest().sidebarWidth
      await press('ArrowRight')
      expect(h.latest().sidebarWidth).toBe(start + 16)
      expect(h.paintedWidth()).toBe(`${start + 16}px`)
      await press('ArrowLeft', true)
      expect(h.latest().sidebarWidth).toBe(start - 48)
      await press('Home')
      expect(h.latest().sidebarWidth).toBe(h.latest().min)
      await press('End')
      expect(h.latest().sidebarWidth).toBe(h.latest().max)
      // Past the bound, the clamp holds.
      await press('ArrowRight')
      expect(h.latest().sidebarWidth).toBe(h.latest().max)
      await press('Enter')
      const reset = h.latest().sidebarWidth
      expect(h.paintedWidth()).toBe(`${reset}px`)

      // An unhandled key is not swallowed — the separator is not a keyboard trap.
      const other = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      h.sash().dispatchEvent(other)
      expect(other.defaultPrevented).toBe(false)

      // Double-click resets, and a global layout reset does too.
      await press('End')
      await h.act(async () => {
        h.sash().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      expect(h.latest().sidebarWidth).toBe(reset)
      await press('End')
      await h.act(async () => {
        window.dispatchEvent(new Event('localix:reset-layout'))
      })
      expect(h.latest().sidebarWidth).toBe(reset)
      expect(h.paintedWidth()).toBe(`${reset}px`)
    } finally {
      await h.cleanup()
    }
  })
})
