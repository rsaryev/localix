import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (url: URL) => readFileSync(url, 'utf8')

describe('database history popover foundation', () => {
  test.each([
    new URL('./HistoryPopover.tsx', import.meta.url),
    new URL('./doc-console/DocHistoryPopover.tsx', import.meta.url),
  ])('%s delegates positioning, dismissal, and scrolling to Popover', (url) => {
    const source = read(url)

    expect(source).toContain('<PopoverContent')
    expect(source).toContain('<PopoverClose')
    expect(source).toContain('layout="structured"')
    expect(source).toContain('<PopoverBody')
    expect(source).not.toContain('POPOVER_SURFACE')
    expect(source).not.toContain('fixed inset-0')
    expect(source).not.toContain('useDismissableOverlay')
  })

  test('keeps close lifecycle on the shared Radix primitive', () => {
    const popover = read(
      new URL('../../../../packages/kit/src/overlays/popover.tsx', import.meta.url),
    )

    expect(popover).toContain('PopoverPrimitive.Close')
    expect(popover).toContain('data-slot="popover-close"')
  })

  test('removes the window-listener escape hatch from the plugin SDK', () => {
    const interactions = read(
      new URL('../../../../packages/plugin-sdk/src/ui/interactions.tsx', import.meta.url),
    )
    const barrel = read(new URL('../../../../packages/plugin-sdk/src/ui/index.ts', import.meta.url))

    expect(interactions).not.toContain('useDismissableOverlay')
    expect(barrel).not.toContain('useDismissableOverlay')
  })
})
