import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaneStateOverlay } from './pane-state-overlay'

describe('PaneStateOverlay', () => {
  test('provides shared pane geometry with caller-owned interaction policy', () => {
    const html = renderToStaticMarkup(
      <PaneStateOverlay className="pointer-events-none z-10">Reconnecting</PaneStateOverlay>,
    )

    expect(html).toContain('data-slot="pane-state-overlay"')
    expect(html).toContain('data-material="dimmed"')
    expect(html).toContain('absolute inset-0')
    expect(html).toContain('bg-background/70')
    expect(html).toContain('backdrop-blur-xs')
    expect(html).toContain('pointer-events-none')
    expect(html).not.toContain('role=')
  })

  test('keeps ended output legible and supports fully opaque states', () => {
    const subtle = renderToStaticMarkup(
      <PaneStateOverlay material="subtle">Terminal ended</PaneStateOverlay>,
    )
    const solid = renderToStaticMarkup(
      <PaneStateOverlay material="solid">Preview unavailable</PaneStateOverlay>,
    )

    expect(subtle).toContain('data-material="subtle"')
    expect(subtle).toContain('bg-background/35')
    expect(subtle).toContain('backdrop-blur-[1px]')
    expect(solid).toContain('data-material="solid"')
    expect(solid).toContain('bg-background')
    expect(solid).not.toContain('backdrop-blur')
  })
})
