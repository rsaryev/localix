import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  FLOATING_SURFACE,
  MENU_CONTENT,
  MENU_DANGER_ITEM,
  MENU_ITEM,
  MENU_SHORTCUT,
  POPOVER_ACTION,
  POPOVER_SURFACE,
  POPOVER_SURFACE_OVER_FOREIGN,
} from './popover-surface'
import { kitTsxSources } from '../testing/jsx-contract'
import { structuredPopoverViolations } from '../testing/overlay-contracts'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('workbench floating-surface contracts', () => {
  test('all menu entry points share compact IDE geometry and semantic states', () => {
    expect(POPOVER_SURFACE).toContain('lx-floating-surface')
    expect(POPOVER_SURFACE).toContain('shadow-(--shadow-popover)')
    expect(MENU_CONTENT).toContain('z-(--z-popover)')
    expect(MENU_CONTENT).toContain('overscroll-contain')
    // The 24px row height the docblock cites, spelled as the scale's token.
    expect(MENU_ITEM).toContain('min-h-[var(--chrome-control-sm)]')
    expect(MENU_ITEM).toContain('cursor-default')
    expect(MENU_ITEM).toContain('disabled:opacity-50')
    expect(MENU_ITEM).toContain('data-disabled:opacity-50')
    expect(MENU_DANGER_ITEM).toContain('text-status-error')
    expect(MENU_SHORTCUT).toContain('ml-auto')
    expect(POPOVER_ACTION).toContain('h-[var(--chrome-control-sm)]')
    // The app's one focus utility, not a transcribed ring — see index.css `@utility focus-ring`.
    expect(POPOVER_ACTION).toContain('focus-ring')
    expect(POPOVER_ACTION).not.toContain('focus-visible:ring')

    for (const source of [
      read('./dropdown-menu.tsx'),
      read('./context-menu.tsx'),
      read('./coordinate-menu.tsx'),
    ]) {
      expect(source).toContain('MENU_CONTENT')
      expect(source).toContain('MENU_ITEM')
      expect(source).toContain('MENU_DANGER_ITEM')
    }

    for (const source of [read('./dropdown-menu.tsx'), read('./context-menu.tsx')]) {
      expect(source).toContain('SubTrigger')
      expect(source).toContain('SubContent')
      expect(source).toContain('Shortcut')
    }

    const coordinate = read('./coordinate-menu.tsx')
    expect(coordinate).toContain('<PopoverAnchor asChild>')
    expect(coordinate).toContain('collisionPadding={8}')
    expect(coordinate).toContain("event.key === 'ArrowDown'")
    expect(coordinate).toContain("event.key === 'Home'")
  })

  test('popover content is collision-aware and viewport scrollable', () => {
    const source = read('./popover.tsx')
    expect(source).toContain('collisionPadding = 8')
    expect(source).toContain('var(--radix-popover-content-available-height)')
    expect(source).toContain('overscroll-contain')
  })

  test('every structured popover keeps pinned regions around one scrolling body', async () => {
    const popover = read('./popover.tsx')
    expect(popover).toContain('data-slot="popover-header"')
    expect(popover).toContain('data-slot="popover-body"')
    expect(popover).toContain('data-slot="popover-footer"')
    expect(popover).toContain('role="group"')
    expect(popover).toContain("type PopoverContentLayout = 'freeform' | 'structured'")
    expect(popover).toContain("layout = 'freeform'")
    expect(popover).toContain('data-layout={layout}')
    expect(popover).toContain("layout === 'structured' ? 'gap-0 overflow-hidden p-0'")

    // The kit's own popovers. The product's are the host half of this rule, in
    // `apps/ui/src/shared/ui/overlays.contract.test.ts`, because the kit never reads the host.
    const { checked, violations } = structuredPopoverViolations(await kitTsxSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test('the structured-popover detector reads both directions (positive control)', () => {
    const scan = (source: string) =>
      structuredPopoverViolations([{ path: 'x.tsx', source }]).violations
    expect(
      scan('<PopoverContent layout="structured"><PopoverHeader /><PopoverBody /></PopoverContent>'),
    ).toEqual([])
    expect(scan('<PopoverContent><PopoverBody /></PopoverContent>')).toEqual([
      'x.tsx:1 must opt into structured layout when it uses a structured region',
    ])
    expect(scan('<PopoverContent layout="structured"><PopoverFooter /></PopoverContent>')).toEqual([
      'x.tsx:1 must declare the one scrolling PopoverBody',
    ])
  })

  test('tooltips share a workbench delay group with an isolated-mount fallback', () => {
    const source = read('./tooltip.tsx')
    expect(source).toContain('TooltipScopeContext')
    expect(source).toContain('delayDuration = 500')
    expect(source).toContain('skipDelayDuration = 300')
    expect(source).toContain('hasSharedProvider ? root')
    // The label is cut from the shared floating material rather than a transcription of it, so
    // it carries every piece the material does — the frost marker AND the rim ring it once lost.
    expect(source).toContain('FLOATING_SURFACE')
    expect(FLOATING_SURFACE).toContain('lx-floating-surface')
    expect(FLOATING_SURFACE).toContain('ring-1 ring-foreground/10')
  })
})

describe('a panel that floats over content the app does not own', () => {
  test('it is opaque, and carries none of the markers the frost rules select on', () => {
    // The translucent surface assumes it frosts over the app's own chrome, whose tone is known.
    // Over a stranger's page it frosts over whatever is there — observed as an unreadable card in
    // the preview's comment composer, above a beige game board.
    expect(POPOVER_SURFACE_OVER_FOREIGN).toContain('bg-background-solid')
    expect(POPOVER_SURFACE_OVER_FOREIGN).not.toContain('lx-floating-surface')
    expect(POPOVER_SURFACE_OVER_FOREIGN).not.toContain('bg-popover')
    // Still the same panel in every other respect.
    expect(POPOVER_SURFACE_OVER_FOREIGN).toContain('shadow-(--shadow-popover)')
    expect(POPOVER_SURFACE_OVER_FOREIGN).toContain('rounded-xl')
    expect(POPOVER_SURFACE_OVER_FOREIGN).toContain('border-control-border')
  })

  // Who picks this material — the shared comment card, by where it floats — is the host's
  // business: that case lives in `apps/ui/src/shared/ui/overlays.contract.test.ts`.
})
