import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/**
 * The behaviour a live incident bought: a contributed surface that throws during render must cost
 * that surface and nothing else. The app previously had ONE boundary, at the root, so a plugin
 * work-item body building a `localix://` URI from an empty id took the entire workspace down —
 * and, being a restorable tab, took it down again on every start.
 */
describe('SurfaceErrorBoundary', () => {
  test('contains a throwing child and keeps its siblings alive', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SurfaceErrorBoundary } = await import('./SurfaceErrorBoundary')

    function Boom(): React.ReactElement {
      throw new TypeError('Localix URI breadcrumbs must be non-empty, bounded identity segments')
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    // React logs the caught error; keep the suite output readable without hiding a real failure.
    const consoleError = console.error
    console.error = () => {}
    try {
      await act(async () =>
        root.render(
          <div>
            <SurfaceErrorBoundary surface="The sample-content tab">
              <Boom />
            </SurfaceErrorBoundary>
            <p data-sibling>still here</p>
          </div>,
        ),
      )
    } finally {
      console.error = consoleError
    }

    const alert = host.querySelector('[data-surface-error]')
    expect(alert?.getAttribute('data-surface-error')).toBe('The sample-content tab')
    expect(alert?.textContent).toContain('could not render')
    // The reason is no longer repeated on the surface: it is one line plus a way into the Event
    // Center, which holds the message, the hint and the trace.
    expect(alert?.textContent).toContain('Details')
    // The whole point: everything outside the boundary survived.
    expect(host.querySelector('[data-sibling]')?.textContent).toBe('still here')

    await act(async () => root.unmount())
  })

  test('renders its children untouched when nothing throws', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SurfaceErrorBoundary } = await import('./SurfaceErrorBoundary')

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <SurfaceErrorBoundary surface="A tab">
          <p data-ok>content</p>
        </SurfaceErrorBoundary>,
      ),
    )

    expect(host.querySelector('[data-ok]')?.textContent).toBe('content')
    expect(host.querySelector('[data-surface-error]')).toBeNull()

    await act(async () => root.unmount())
  })
  test('a render-null background component that throws shows nothing but still contains', async () => {
    // The `Mount` case: always-mounted lifecycle components render null, so there is no tab to
    // close and no visible tell. Containment is the entire value — the fallback must not paint a
    // full-height error panel into a layout that expected nothing.
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SurfaceErrorBoundary } = await import('./SurfaceErrorBoundary')

    function BackgroundBoom(): React.ReactElement {
      throw new Error('publisher exploded')
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    const consoleError = console.error
    console.error = () => {}
    try {
      await act(async () =>
        root.render(
          <div>
            <SurfaceErrorBoundary surface="The k8s background" fallback="silent">
              <BackgroundBoom />
            </SurfaceErrorBoundary>
            <p data-app>app</p>
          </div>,
        ),
      )
    } finally {
      console.error = consoleError
    }

    expect(host.querySelector('[data-app]')?.textContent).toBe('app')
    // NOTHING painted. The component rendered null when it worked, so an error panel in its place
    // would be its own visual bug — a card shoved into a layout that expected an empty node. The
    // console line and the surviving app are the only honest signal here. (Same split lobehub
    // makes between its AlertFallback and SilentFallback.)
    expect(host.querySelector('[data-surface-error]')).toBeNull()

    await act(async () => root.unmount())
  })
})
