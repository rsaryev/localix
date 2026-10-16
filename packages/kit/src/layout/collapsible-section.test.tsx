import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollapsibleSection } from './collapsible-section'

describe('CollapsibleSection', () => {
  it('presents its count as quiet metadata without a pill background', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Changes" count={12}>
        <span>content</span>
      </CollapsibleSection>,
    )

    expect(html).toContain('Changes')
    expect(html).toContain('>12<')
    expect(html).toContain('tabular-nums')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('bg-surface-active')
  })

  it('keeps disclosure and trailing actions as separate named controls', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Changes" actions={<button type="button">Refresh</button>}>
        <span>content</span>
      </CollapsibleSection>,
    )

    const triggerStart = html.indexOf('data-slot="collapsible-section-trigger"')
    const triggerEnd = html.indexOf('</button>', triggerStart)
    const actionsStart = html.indexOf('data-slot="collapsible-section-actions"')
    const controlsId = html.match(/aria-controls="([^"]+)"/)?.[1]

    expect(html).toContain('<button type="button" data-slot="collapsible-section-trigger"')
    expect(html).toContain('role="group" aria-label="Changes actions"')
    expect(triggerStart).toBeGreaterThan(-1)
    expect(triggerEnd).toBeLessThan(actionsStart)
    expect(controlsId).toBeTruthy()
    expect(html).toContain(`id="${controlsId}" data-slot="collapsible-section-content"`)
  })

  it('exposes a labeled horizontal sash when the section is resizable', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Changes" resizable resizeStorageKey="test-changes">
        <span>content</span>
      </CollapsibleSection>,
    )

    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-label="Resize Changes section"')
    expect(html).toContain('lx-sash')
    expect(html).toContain('aria-orientation="horizontal"')
    expect(html).toContain('aria-valuetext="Automatic height"')
    expect(html).toContain('aria-description="Drag to resize · Use arrow keys to adjust')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('title=')
  })
})
