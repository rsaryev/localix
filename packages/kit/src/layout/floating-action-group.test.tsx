import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RefreshCw } from 'lucide-react'
import { ActionPill } from '../controls/action-pill'
import { FloatingActionGroup } from './workbench-toolbar'

describe('floating editor actions', () => {
  test('uses a named native-Tab group on the semantic controls layer', () => {
    const html = renderToStaticMarkup(
      <FloatingActionGroup aria-label="Viewer actions">
        <button type="button">Copy</button>
      </FloatingActionGroup>,
    )

    expect(html).toContain('data-slot="floating-action-group"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Viewer actions"')
    expect(html).not.toContain('role="toolbar"')
    expect(html).toContain('z-(--z-controls)')
    expect(html).toContain('right-2 top-2')
  })

  test('supports bottom placement and responsive wrapping without local z-indexes', () => {
    const html = renderToStaticMarkup(
      <FloatingActionGroup aria-label="Navigation" placement="bottom-end" wrap />,
    )

    expect(html).toContain('data-placement="bottom-end"')
    expect(html).toContain('bottom-2 right-2')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('justify-end')
    expect(html).toContain('max-w-[calc(100%-1rem)]')

    const start = renderToStaticMarkup(
      <FloatingActionGroup aria-label="Start actions" placement="top-start" wrap />,
    )
    expect(start).toContain('left-2 top-2')
    expect(start).toContain('justify-start')
    expect(start).not.toContain('justify-end')
  })

  test('action pills inherit shared button geometry, focus, and accessible labels', () => {
    const html = renderToStaticMarkup(
      <ActionPill aria-label="Reload preview">
        <RefreshCw />
      </ActionPill>,
    )

    expect(html).toContain('data-slot="button"')
    // Ghost, not outline: the FloatingActionGroup around it is the single painter of the floating
    // material. A pill with its own fill and hairline made every label a separate black chip.
    expect(html).toContain('data-variant="ghost"')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).toContain('data-size="xs"')
    expect(html).toContain('h-[var(--chrome-control-xs)]')
    expect(html).toContain('aria-label="Reload preview"')
    expect(html).toContain('focus-visible:ring-control-border-focus')
  })
})
