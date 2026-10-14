import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'
import { Spinner } from '@localixai/kit/spinner'

const css = readKitStylesheet()
const targetRegistrySource = readFileSync(
  resolve(import.meta.dir, '../shared/lib/uiTargetRegistry.ts'),
  'utf8',
)
const settingsSource = readFileSync(
  resolve(import.meta.dir, '../features/settings/ui/SettingsPanel.tsx'),
  'utf8',
)

describe('reduced-motion contracts', () => {
  it('removes animation and transition delays as well as their duration', () => {
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation-delay: 0s !important;[\s\S]*?transition-delay: 0s !important;/,
    )
    expect(reducedMotionBlock).not.toBeNull()
  })

  it('keeps streaming and settings progress visible without cycling motion', () => {
    expect(css).toContain("content: '…';")
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.lx-target-reveal \{[\s\S]*?animation: none;[\s\S]*?box-shadow: inset 0 0 0 1px color-mix/,
    )
  })

  it('keeps shimmer activity text visible in forced-colors mode', () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*?\.lx-shimmer \{[\s\S]*?background: none;[\s\S]*?color: CanvasText;/,
    )
  })

  it('uses instant programmatic scrolling when motion is reduced', () => {
    expect(targetRegistrySource).toContain("behavior: prefersReducedMotion() ? 'auto' : 'smooth'")
    expect(settingsSource).toContain("behavior: prefersReducedMotion() ? 'auto' : 'smooth'")
  })

  it('keeps a stopped spinner understandable to assistive technology', () => {
    const html = renderToStaticMarkup(<Spinner label="Loading" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
    expect(html).toContain('lx-activity-orb__orbit')
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.lx-activity-orb__orbit,[\s\S]*?animation: none !important;/,
    )
  })
})
