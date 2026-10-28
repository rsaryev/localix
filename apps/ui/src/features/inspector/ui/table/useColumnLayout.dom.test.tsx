import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import { COL_MIN, GRID_TEMPLATE_VAR } from './useColumnLayout'

/**
 * A column drag must not re-render the grid.
 *
 * The template is shared by the header, every virtualized row, the draft row and the staged-insert
 * rows — that sharing is what keeps them aligned through horizontal scroll. It also means one
 * `setState` per `mousemove` re-rendered all of them, dozens of times a second, to produce a value
 * the browser recomputes from CSS anyway. The drag now writes the custom property directly and
 * commits state once on release.
 *
 * Both halves need proving, because either one alone is a bug: writing the property but never
 * committing loses the width on the next render, and committing per move is the thing this replaced.
 */

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const COLUMNS = [
  { id: 'name', label: 'name', type: 'text' },
  { id: 'size', label: 'size', type: 'text' },
] as const

/** Minimal host: the hook's root plus the one handle a header cell would render. */
async function mountHarness() {
  const React = await import('react')
  const { act, useEffect } = React
  const { createRoot } = await import('react-dom/client')
  const { useColumnLayout } = await import('./useColumnLayout')

  let renders = 0
  let template = ''

  function Harness() {
    const { gridTemplate, widths, rootRef, startResize } = useColumnLayout(
      [...COLUMNS] as never,
      2,
      2,
    )
    useEffect(() => {
      renders += 1
      template = gridTemplate
    })
    return (
      <div
        ref={rootRef}
        data-testid="grid-root"
        style={{ [GRID_TEMPLATE_VAR]: gridTemplate } as React.CSSProperties}
      >
        <div data-testid="width">{widths.name ?? 'unset'}</div>
        <button
          type="button"
          aria-label="Resize name column"
          data-testid="handle"
          onMouseDown={(event) => startResize('name', event)}
          // The hook reads the column's rendered width off the handle's PARENT on grab.
          style={{ width: 8 }}
        />
      </div>
    )
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))

  return {
    host,
    act,
    get renders() {
      return renders
    },
    get template() {
      return template
    },
    root: () => host.querySelector('[data-testid="grid-root"]') as HTMLElement,
    handle: () => host.querySelector('[data-testid="handle"]') as HTMLElement,
    width: () => host.querySelector('[data-testid="width"]')?.textContent,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

function mouse(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
}

describe('column resize', () => {
  test('moves the template through a CSS variable and renders nothing until release', async () => {
    const harness = await mountHarness()
    try {
      const before = harness.renders
      const startX = 200

      await harness.act(async () => {
        harness.handle().dispatchEvent(mouse('mousedown', startX))
      })
      const rendersAtGrab = harness.renders

      await harness.act(async () => {
        for (const dx of [10, 25, 40, 55, 70]) {
          window.dispatchEvent(mouse('mousemove', startX + dx))
        }
      })

      // The property carries the drag…
      const dragged = harness.root().style.getPropertyValue(GRID_TEMPLATE_VAR)
      expect(dragged).toContain('px')
      expect(dragged).not.toBe(harness.template)
      // …and nothing re-rendered while it did.
      expect(harness.renders).toBe(rendersAtGrab)
      expect(harness.width()).toBe('unset')

      await harness.act(async () => {
        window.dispatchEvent(mouse('mouseup', startX + 70))
      })

      // Released: state now remembers where the pointer stopped, exactly once.
      expect(Number(harness.width())).toBeGreaterThanOrEqual(COL_MIN)
      expect(harness.renders).toBeGreaterThan(rendersAtGrab)
      expect(harness.renders - rendersAtGrab).toBeLessThanOrEqual(2)
      expect(harness.renders).toBeGreaterThan(before - 1)
    } finally {
      await harness.cleanup()
    }
  })

  test('a drag below the floor clamps instead of collapsing the column', async () => {
    const harness = await mountHarness()
    try {
      await harness.act(async () => {
        harness.handle().dispatchEvent(mouse('mousedown', 400))
      })
      await harness.act(async () => {
        window.dispatchEvent(mouse('mousemove', 0))
        window.dispatchEvent(mouse('mouseup', 0))
      })
      expect(Number(harness.width())).toBe(COL_MIN)
    } finally {
      await harness.cleanup()
    }
  })

  test('releasing removes the window listeners, so a later move is inert', async () => {
    const harness = await mountHarness()
    try {
      await harness.act(async () => {
        harness.handle().dispatchEvent(mouse('mousedown', 300))
        window.dispatchEvent(mouse('mousemove', 380))
        window.dispatchEvent(mouse('mouseup', 380))
      })
      const settled = harness.root().style.getPropertyValue(GRID_TEMPLATE_VAR)
      const rendersAfterRelease = harness.renders

      await harness.act(async () => {
        window.dispatchEvent(mouse('mousemove', 900))
      })
      expect(harness.root().style.getPropertyValue(GRID_TEMPLATE_VAR)).toBe(settled)
      expect(harness.renders).toBe(rendersAfterRelease)
    } finally {
      await harness.cleanup()
    }
  })
})
