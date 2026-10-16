import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewBlockedOverlay } from './PreviewOverlays'

describe('PreviewBlockedOverlay', () => {
  test('offers the browser and, with a proxy, the embedded view', () => {
    const html = renderToStaticMarkup(
      <PreviewBlockedOverlay
        url="https://example.com"
        injectUrl="http://127.0.0.1:4100/"
        onEngage={() => {}}
      />,
    )

    expect(html).toContain('data-slot="pane-state-overlay"')
    // Nothing is mounted behind the card, so it veils nothing.
    expect(html).toContain('data-material="plain"')
    expect(html).toContain('This site can’t be embedded')
    expect(html).toContain('Open in browser')
    expect(html).toContain('Try embedded view')
  })

  test('omits the embedded view when no proxy can serve the site', () => {
    const html = renderToStaticMarkup(<PreviewBlockedOverlay url="https://example.com" />)

    expect(html).toContain('Open in browser')
    expect(html).not.toContain('Try embedded view')
  })
})
