import { describe, expect, test } from 'bun:test'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const css = readKitStylesheet()

function section(startMarker: string, endMarker: string): string {
  const start = css.indexOf(startMarker)
  const end = css.indexOf(endMarker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end)
}

describe('OS visual-preference contracts', () => {
  test('increased contrast strengthens semantic tokens in both palettes', () => {
    const tokens = section('OS increased-contrast preference', 'Tailwind theme extension')

    expect(tokens).toContain('@media (prefers-contrast: more)')
    expect(tokens).toMatch(/:root\s*\{[\s\S]*?--border-strong:[\s\S]*?--text-faint:/)
    expect(tokens).toContain('var(--foreground) 46%')
    expect(tokens).toContain('var(--sidebar-foreground) 28%')
    expect(tokens).toContain('var(--foreground) 78%')
    expect(tokens).toContain('var(--background)\n    ) !important')
    expect(tokens).toContain('--control-border-focus:')
    expect(tokens).toContain('--scroll-thumb-hover:')
    expect(tokens).toMatch(
      /\[data-theme='light'\]\s*\{[\s\S]*?--tree-guide:[\s\S]*?--scroll-thumb-hover:/,
    )
  })

  test('increased contrast restores structural and active boundaries', () => {
    const behavior = section(
      'High-contrast themes expose two cross-cutting signals',
      'OS forced-colors / Windows High Contrast',
    )

    expect(behavior).toContain('@media (prefers-contrast: more)')
    expect(behavior).toContain('.lx-floating-surface')
    expect(behavior).toContain('.lx-modal-surface')
    expect(behavior).toContain("[aria-selected='true']")
    expect(behavior).toContain("[aria-current]:not([aria-current='false'])")
    expect(behavior).toContain(':focus-visible')
    expect(behavior).toContain('outline: 2px solid var(--ring)')
    expect(behavior).toContain('--sash-line-width: 2px')
  })

  test('reduced transparency removes backdrop compositing and repairs thin materials', () => {
    const contract = section('Respect the OS "Reduce transparency" preference', 'Global keyframes')

    expect(contract).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(contract).toMatch(
      /\.lx-glass\s*\{[\s\S]*?background-color: var\(--popover\);[\s\S]*?backdrop-filter: none;/,
    )
    expect(contract).toMatch(
      /\.lx-scrim\s*\{[\s\S]*?background-color: rgba\(0, 0, 0, 0\.78\);[\s\S]*?backdrop-filter: none;/,
    )
    expect(contract).toContain(":where([class*='backdrop-blur'])")
    expect(contract).toContain("[data-slot='pane-state-overlay']:not([data-material='solid'])")
    expect(contract).toContain("[class*='bg-black/']):not(:hover)")
    expect(contract).not.toContain('forced-color-adjust')
  })

  test('forced colors remains the final authority when preferences overlap', () => {
    const contrastBehavior = css.indexOf('High-contrast themes expose two cross-cutting signals')
    const forcedColors = css.indexOf('OS forced-colors / Windows High Contrast')

    expect(contrastBehavior).toBeGreaterThan(-1)
    expect(forcedColors).toBeGreaterThan(contrastBehavior)
  })
})
