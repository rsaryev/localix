import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./BreadcrumbTrailingActions.tsx', import.meta.url), 'utf8')

test('the command palette stays out of the titlebar', () => {
  expect(source).not.toContain('label="Command palette"')
  expect(source).not.toContain('onOpenCommandPalette')
})

test('the contributed strip spends the width it was measured, not a flat number', () => {
  // The cap used to be four on a window of any size: a maximised display showed four plugin
  // glyphs and hid seven, and a narrow one showed the same four with the path left nothing.
  expect(source).toContain('fitStatusStrip({')
  expect(source).toContain('containerWidth: titlebarWidth')
  expect(source).toContain('max={fit.visible}')
  expect(source).toContain('compact={fit.compact}')
  // The ceiling stays — a bar that grows without bound leaves the breadcrumb nowhere to truncate.
  expect(source).toContain('const MAX_VISIBLE_TITLEBAR_ITEMS = 12')
})

test('the strip yields to the navigation path by its DEPTH, not by a fixed share of the row', () => {
  // A share was a stand-in for the fact that actually varies. `[Global]` alone has no use for the
  // left half of a maximised titlebar, and a five-deep session path needs more than 40% of a
  // narrow one — the same constant was wrong in both directions.
  expect(source).toContain('useBreadcrumbDepth()')
  expect(source).toContain('breadcrumbDepth,')
})

test('the strip is sized on the plugins that are DRAWING, not on the registered ones', () => {
  // Most bundled titlebar items return `null` until they have something to say. Sizing on
  // declarations spent their slots anyway — four glyphs reached the bar and the rest folded
  // into a `…` whose rows were `null` too, so the menu opened empty.
  expect(source).toContain('useLiveStatusItemCount')
  expect(source).not.toContain('useStatusItemCount(')
})

test('the strip measures its host row rather than itself', () => {
  // Its own column is intrinsic, so measuring it would be reading back its own answer.
  expect(source).not.toContain('useElementWidth')
  expect(source).toContain('titlebarWidth?: number | null')
})

test('the three core buttons are one group, pinned to the right of every plugin glyph', () => {
  // They used to straddle the plugins — palette and terminal before, bell after — so the row's
  // right edge was a different control depending on how many plugins happened to be speaking.
  const plugins = source.indexOf('aria-label="Plugin items"')
  const core = source.indexOf('aria-label="Workspace actions"')
  expect(plugins).toBeGreaterThan(0)
  expect(core).toBeGreaterThan(plugins)
  for (const control of ['label="Browser"', 'label="Terminal"', '<NotificationCenterLauncher />']) {
    expect(source.indexOf(control), control).toBeGreaterThan(core)
  }
  // Never folded, whatever the strip is doing beside it.
  expect(source).toContain('className="flex shrink-0 items-center gap-1"')
})

test('the plugin zone is fenced on both sides, and the leading rule is conditional', () => {
  // Two rules with nothing between them is the seam a session with no speaking plugin would
  // otherwise leave against the breadcrumb.
  expect(source).toContain('{contributedCount > 0 && <Rule />}')
  expect(source).toContain('aria-haspopup="menu"')
})
