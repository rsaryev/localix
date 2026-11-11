import { describe, expect, test } from 'bun:test'
import { EMBEDDED_VISUAL_PREFERENCES_CSS } from './embedded-visual-preferences'

describe('sandboxed UI visual preferences', () => {
  test('stops authored motion without hiding its final state', () => {
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('animation-duration:0.01ms!important')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('animation-delay:0s!important')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('animation-iteration-count:1!important')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('transition-duration:0.01ms!important')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('transition-delay:0s!important')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('scroll-behavior:auto!important')
  })

  test('derives increased-contrast chrome from the forwarded mini app palette', () => {
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('@media (prefers-contrast: more)')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain(
      '--border:color-mix(in oklch,var(--foreground) 28%,var(--background))!important',
    )
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('--text-faint:color-mix')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('outline:2px solid var(--ring)')
  })

  // WKWebView never matches `prefers-reduced-transparency`, so the frame is told by the host,
  // which stamps the frame's root the way the shell stamps its own.
  test('turns off authored backdrop compositing when the host says Reduce transparency', () => {
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).not.toContain('prefers-reduced-transparency')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain(":root[data-reduce-transparency='true']")
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain("[style*='backdrop-filter']")
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('backdrop-filter:none!important')
  })

  test('restores focus and selected boundaries after mini app CSS resets', () => {
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('@media (forced-colors: active)')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain('outline:2px solid Highlight')
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain("[aria-selected='true']")
    expect(EMBEDDED_VISUAL_PREFERENCES_CSS).toContain(':focus-visible')
  })
})
