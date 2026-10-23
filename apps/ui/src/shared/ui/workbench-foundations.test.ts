import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const uiRoot = resolve(import.meta.dir, '../..')

/**
 * Bundled mini app UI surfaces that mount the shared tab row, found by scanning the mini app
 * tree. Core may hold mini app UI to a shared contract; it may not name a concrete mini app.
 */
const miniAppTabBarConsumers = () => {
  const miniAppsRoot = resolve(uiRoot, '../../..', 'mini-apps')
  return readdirSync(miniAppsRoot, { encoding: 'utf8', recursive: true })
    .filter(
      (entry) =>
        entry.endsWith('.tsx') &&
        !/(?:^|[\\/])(?:node_modules|dist)[\\/]/u.test(entry) &&
        !/\.(?:dom\.)?test\.tsx$/u.test(entry),
    )
    .map((entry) => ({
      path: `mini-apps/${entry}`,
      source: readFileSync(resolve(miniAppsRoot, entry), 'utf8'),
    }))
    .filter(({ source }) => source.includes('<TabBar'))
}

describe('workbench foundation contracts', () => {
  test('no bundled mini app surface suppresses the shared tab-row seam', () => {
    // The seam belongs to the primitive. A consumer that needs a control beside the tabs passes
    // `trailing` instead of suppressing the line and redrawing it. Core must not know which
    // mini app that is: discover the consumers instead of naming a tree.
    const miniAppConsumers = miniAppTabBarConsumers()
    expect(
      miniAppConsumers.length,
      'no bundled mini app surface mounts the shared tab row',
    ).toBeGreaterThan(0)
    for (const { path, source } of miniAppConsumers) {
      expect(source, `${path} suppresses the shared tab-row seam`).not.toContain('border-b-0')
    }
  })

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
