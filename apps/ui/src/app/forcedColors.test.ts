import { describe, expect, test } from 'bun:test'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'
import { SELECTED_ROW } from '@localixai/kit/selected-row'

const css = readKitStylesheet()

function forcedColorsContract(): string {
  const start = css.indexOf('@media (forced-colors: active) {', css.indexOf('OS forced-colors'))
  const end = css.indexOf('/* ── Native chrome', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end)
}

describe('OS forced-colors workbench contract', () => {
  test('repairs only signals that the forced palette removes', () => {
    const contract = forcedColorsContract()

    expect(contract).toContain('.lx-floating-surface')
    expect(contract).toContain('.lx-modal-surface')
    expect(contract).toContain('border: 2px solid CanvasText')
    expect(contract).toContain('box-shadow: none')
    expect(contract).toContain("[aria-selected='true']")
    expect(contract).toContain("[role='tab'][data-state='active']")
    expect(contract).toContain("[role='menuitemradio'][aria-checked='true']")
    expect(contract).toContain("[data-selected='true']")
    expect(contract).toContain("button[aria-pressed='true']")
    expect(contract).toContain("button[aria-expanded='true']")
    expect(contract).toContain("[aria-current]:not([aria-current='false'])")
    expect(contract).toContain('outline: 2px solid Highlight')
    expect(contract).toContain('outline: 1px dashed Highlight')
    expect(contract).toContain("[aria-disabled='true']")
    expect(contract).toContain('color: GrayText')
  })

  test('keeps content in the user palette while making the empty scrim transparent', () => {
    const contract = forcedColorsContract()
    const optOuts = contract.match(/forced-color-adjust:\s*none/g) ?? []

    expect(optOuts).toHaveLength(1)
    expect(contract).toMatch(
      /\.lx-scrim\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?forced-color-adjust:\s*none;/,
    )
    expect(contract).not.toMatch(/\.lx-(?:floating|modal)-surface\s*\{[^}]*forced-color-adjust/)
  })

  test('preserves resize and drag/drop intent without relying on color fills or shadows', () => {
    const contract = forcedColorsContract()

    expect(contract).toContain('.lx-sash::after')
    expect(contract).toContain('background-color: CanvasText')
    expect(contract).toContain("[data-agent-link-drop-target]:not([data-drop-active='true'])")
    expect(contract).toContain("[data-agent-link-drop-target][data-drop-active='true']")
    expect(contract).toContain('outline: 3px solid Highlight')
    expect(SELECTED_ROW).toContain('lx-selected-row')
  })
})
