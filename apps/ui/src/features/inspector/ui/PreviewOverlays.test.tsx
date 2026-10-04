import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewStatusOverlay } from './PreviewOverlays'

describe('PreviewStatusOverlay', () => {
  test('exposes restart as the primary stopped-state action when it is callable', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        starting
        canStart
        startCommand="bun dev"
        url="http://127.0.0.1:3000"
        onStart={() => {}}
        onReload={() => {}}
      />,
    )

    expect(html).toContain('data-slot="pane-state-overlay"')
    // Nothing is behind this notice — no iframe mounted, no ghost frame — so the layer veils
    // nothing. A scrim over the pane's own ground is a second, slightly different material,
    // which is what made the preview read as a bright slab in the light theme. (And it is
    // never a black wash: over a dead iframe's white fill that pairing is the grey slab this
    // overlay was rewritten to stop producing.)
    expect(html).toContain('data-material="plain"')
    expect(html).not.toContain('bg-black/')
    expect(html).toContain('data-slot="preview-dormant-surface"')
    expect(html).not.toContain('lx-floating-surface')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="Preview recovery actions"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).not.toContain('Reload')
    expect(html).toContain('Waking…')
  })

  test('makes reload primary when a stopped preview cannot be restarted', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        canStart
        url="http://127.0.0.1:3000"
        onReload={() => {}}
      />,
    )

    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('Try again')
    expect(html).not.toContain('Restart')
  })

  /**
   * The dormant pane says what the empty one says and no more: a glyph, a title, an action.
   * Spelled into a sentence, the command wrapped across three lines and buried the state it
   * was explaining, so it moved to the action's hover — where it is asked for, not read past.
   */
  test('keeps the notice to a title and an action, with the command on hover', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        canStart
        startCommand="python3 -m http.server 8000"
        url="http://127.0.0.1:8000"
        onStart={() => {}}
        onReload={() => {}}
      />,
    )

    expect(html).toContain('Preview is sleeping')
    expect(html).toContain('Wake preview')
    // The command hangs off a hover surface (Radix renders its content only when open),
    // never a native title attribute — those two doubled up on every migrated control.
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title="Run:')
    // Nothing else on the pane: no prose line under the title.
    expect(html).not.toContain('stopped answering')
    expect(html).not.toContain('Waking it runs')

    const noCommand = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        canStart
        url="http://127.0.0.1:8000"
        onStart={() => {}}
        onReload={() => {}}
      />,
    )
    expect(noCommand).not.toContain('data-tooltip-trigger')
  })

  test('shows the last frame behind the notice, labelled as a ghost', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        canStart
        url="http://127.0.0.1:3000"
        lastFrame={{
          src: 'data:image/jpeg;base64,AAA',
          width: 800,
          height: 600,
          capturedAt: Date.now() - 5 * 60_000,
        }}
        onReload={() => {}}
      />,
    )

    expect(html).toContain('data-ghost="frame"')
    expect(html).toContain('data:image/jpeg;base64,AAA')
    expect(html).toContain('Last frame · 5m ago')
    // A ghost IS something to sink behind the notice, so this one does veil.
    expect(html).toContain('data-material="subtle"')
  })

  test('falls back to the themed empty surface when no frame was ever captured', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="stopped"
        canStart
        url="http://127.0.0.1:3000"
        onReload={() => {}}
      />,
    )

    expect(html).toContain('data-ghost="empty"')
    expect(html).not.toContain('Last frame')
  })

  test('never presents a cached frame for a site that refused to embed', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="blocked"
        url="https://example.com"
        lastFrame={{
          src: 'data:image/jpeg;base64,AAA',
          width: 8,
          height: 6,
          capturedAt: Date.now(),
        }}
        onReload={() => {}}
      />,
    )

    expect(html).toContain('data-ghost="empty"')
    expect(html).not.toContain('base64,AAA')
    expect(html).not.toContain('Last frame')
  })

  test('reports a launch failure as one problem line without changing recovery actions', () => {
    const html = renderToStaticMarkup(
      <PreviewStatusOverlay
        kind="unreachable"
        startProblem={{
          report: {
            subject: { label: 'Preview server' },
            problems: [{ message: 'Server exited with code 1' }],
            consequence: 'blocked',
          },
        }}
        url="http://127.0.0.1:3000"
        onReload={() => {}}
      />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('Server exited with code 1')
    expect(html).toContain('Details')
    expect(html).toContain('Reload')
    expect(html).toContain('Open in browser')
  })
})
