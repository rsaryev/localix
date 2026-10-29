import { describe, expect, test } from 'bun:test'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

describe('workbench foundation contracts', () => {
  test('orders app overlays by semantic layer instead of a shared magic tier', () => {
    const css = readKitStylesheet()
    const value = (token: string) =>
      Number(css.match(new RegExp(`${token}: (\\d+);`))?.[1] ?? Number.NaN)

    expect(value('--z-navigation-backdrop')).toBeLessThan(value('--z-sidebar'))
    expect(value('--z-sidebar')).toBeLessThan(value('--z-modal-backdrop'))
    expect(value('--z-modal-backdrop')).toBeLessThan(value('--z-modal'))
    expect(value('--z-modal')).toBeLessThan(value('--z-popover'))
    expect(value('--z-popover')).toBeLessThan(value('--z-tooltip'))
  })
})
