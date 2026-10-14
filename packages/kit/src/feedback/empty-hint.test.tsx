import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyHint, LoadingHint } from './empty-hint'
import { readKitStylesheet } from '../testing/stylesheet'

describe('LoadingHint', () => {
  /**
   * A fast open (warm session, cached tab body, an already-resolved lazy chunk)
   * resolves well inside the delay, so the hint must not paint at all — otherwise
   * every first open flashes a loading string. A progress indicator is started
   * with an explicit delay for the same reason.
   */
  test('reveals on a delay and holds at zero opacity until then', () => {
    const html = renderToStaticMarkup(<LoadingHint>Loading conversation…</LoadingHint>)

    expect(html).toContain('animate-in')
    expect(html).toContain('fade-in')
    expect(html).toContain('[animation-delay:300ms]')
    // Without `both`, the element paints at its natural opacity for the whole
    // delay — which IS the flash we are removing.
    expect(html).toContain('[animation-fill-mode:both]')
  })

  test('stays announced and keeps its copy and layout', () => {
    const html = renderToStaticMarkup(<LoadingHint>Loading conversation…</LoadingHint>)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Loading conversation')
    expect(html).toContain('items-center')
  })

  test('caller classes still apply on top of the reveal', () => {
    const html = renderToStaticMarkup(<LoadingHint className="min-h-14 text-xs" />)
    expect(html).toContain('min-h-14')
    expect(html).toContain('[animation-delay:300ms]')
  })

  /**
   * The delay is CSS-only so it costs no timer and no second render, and the
   * global reduced-motion kill (`animation-delay: 0s !important`) collapses it to
   * an immediate paint for users who asked for no motion.
   */
  test('reduced motion collapses the delay globally', () => {
    const css = readKitStylesheet()
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation-delay: 0s !important;/,
    )
  })

  test('EmptyHint is not delayed — it is a resting state, not a transient one', () => {
    expect(renderToStaticMarkup(<EmptyHint>Nothing here</EmptyHint>)).not.toContain(
      'animation-delay',
    )
  })
})
