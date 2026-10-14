import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WorkbenchStatusBar,
  WorkbenchStatusButton,
  WorkbenchStatusItem,
} from './workbench-statusbar'

describe('WorkbenchStatusBar', () => {
  test('uses the shared status geometry without creating a live region', () => {
    const html = renderToStaticMarkup(
      <WorkbenchStatusBar aria-label="Editor status" align="end" divided>
        <WorkbenchStatusItem>Ln 4, Col 7</WorkbenchStatusItem>
      </WorkbenchStatusBar>,
    )

    expect(html).toContain('data-slot="workbench-statusbar"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Editor status"')
    expect(html).toContain('h-[var(--statusbar-height)]')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('justify-end')
    expect(html).toContain('divide-x')
    expect(html).not.toContain('role="status"')
  })

  test('keeps read-only and interactive segments on the same bounded geometry', () => {
    const item = renderToStaticMarkup(<WorkbenchStatusItem>TypeScript</WorkbenchStatusItem>)
    const button = renderToStaticMarkup(
      <WorkbenchStatusButton aria-label="Open Problems">LSP</WorkbenchStatusButton>,
    )

    for (const html of [item, button]) {
      expect(html).toContain('h-full')
      expect(html).toContain('min-w-0')
      // Bounded by the PANE it sits in, not by a fraction of the viewport.
      expect(html).toContain('max-w-full')
      expect(html).not.toContain('40vw')
      expect(html).toContain('overflow-hidden')
    }
    expect(button).toContain('type="button"')
    expect(button).toContain('focus-ring')
  })

  test('supports a sidebar summary row above list content', () => {
    const html = renderToStaticMarkup(
      <WorkbenchStatusBar aria-label="Search summary" seam="bottom" tone="sidebar" divided>
        <WorkbenchStatusItem>12 results</WorkbenchStatusItem>
      </WorkbenchStatusBar>,
    )

    expect(html).toContain('data-seam="bottom"')
    expect(html).toContain('border-b')
    expect(html).toContain('border-sidebar-border')
    expect(html).toContain('divide-sidebar-border')
    expect(html).not.toContain('border-t')
  })
})
