import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const material = readFileSync(new URL('../../styles/window-material.css', import.meta.url), 'utf8')

describe('shared window material', () => {
  test('keeps the synthetic backdrop but clears it for native macOS desktop glass', () => {
    expect(material).toContain(":root[data-theme='dark']")
    expect(material).toContain(":root[data-theme='light']")
    expect(material).toContain('background: var(--window-backdrop) fixed')
    expect(material).toContain('radial-gradient')
    expect(material).toContain(
      ":root[data-desktop='true'][data-os='mac']:is([data-theme='dark'], [data-theme='light']) {\n    background: transparent;",
    )
  })

  test('covers both floating and modal families with one coat and blur', () => {
    expect(material).toContain(':is(.bg-popover, .lx-floating-surface)')
    expect(material).toContain('.lx-modal-surface')
    expect(material).toContain('-webkit-backdrop-filter: blur(24px) saturate(1.1)')
    expect(material).toContain('backdrop-filter: blur(24px) saturate(1.1)')
  })

  test('scales the tuned coats by the transparency level instead of restating them', () => {
    expect(material).toContain('var(--work-density) * var(--coat-scale, 1)')
    expect(material).toContain('var(--sidebar-density) * var(--coat-scale, 1)')
    expect(material).toContain('var(--window-ground) var(--work-coat)')
    expect(material).toContain('var(--window-ground-sidebar) var(--sidebar-coat)')
    // Off must out-rank the rule that clears the macOS root for the native material.
    expect(material).toContain(
      ":root[data-desktop='true'][data-os='mac'][data-window-transparency='off']",
    )
    // The OS preference is declared after the levels, so it still wins over any of them.
    expect(material.indexOf("[data-window-transparency='off']")).toBeLessThan(
      material.indexOf('(prefers-reduced-transparency: reduce), (forced-colors: active)'),
    )
  })

  test('requires compositing and respects accessibility preferences', () => {
    expect(material).toContain('@supports (background: color-mix')
    expect(material).toContain(
      '((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    )
    expect(material).toContain('(prefers-reduced-transparency: reduce), (forced-colors: active)')
    expect(material).toContain('--popover: var(--popover-solid)')
    expect(material).toContain('backdrop-filter: none')
  })
})
