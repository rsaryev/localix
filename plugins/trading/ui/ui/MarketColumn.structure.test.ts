import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('market column geometry', () => {
  test('gives both side-panel tabs a scrollable min-h-0 body', () => {
    const panel = read('MarketSidePanel.tsx')
    expect(panel.match(/className="flex min-h-0 flex-1 flex-col"/g)?.length).toBe(2)
    expect(panel).not.toContain('className="flex flex-1 flex-col"')
  })

  test('keeps the book and tape column headers on one seam, surface and padding', () => {
    // `lx-occluder`, not a hand-written fill: the shared sticky-strip recipe. A coat of the
    // pane's OWN ground composites denser than the pane under glass — the black bar these two
    // headers used to draw — so the recipe lifts with a foreground veil and hides with its blur.
    const header =
      /lx-occluder sticky top-0 z-\(--z-sticky\) flex[^"]*border-b border-border-soft px-2 py-1\b/
    expect(read('OrderBook.tsx')).toMatch(header)
    expect(read('TradesTape.tsx')).toMatch(header)
  })

  /**
   * JUNCTION RULES for the market browser, which is the same component twice: a standalone
   * left-rail view, and a pane docked under Trading Workspace's section toolbar.
   *
   * 1. Embedded, the toolbar above already names the section, so a panel header there was a
   *    second 36px row and a second seam repeating it. Both DevOps inventories gate their
   *    header on `!embedded` and move its action into the control row below.
   * 2. Every control row in the column indents to the same `px-3` content edge as the header
   *    above it and the market rows below it. It used to run 12 / 10 / 8 down the column.
   */
  test('does not repeat the workspace section name in an embedded panel header', () => {
    const sidebar = read('PublicMarketsSidebar.tsx')
    expect(sidebar).toContain('{!embedded && (')
    expect(sidebar).not.toContain('Market browser')
  })

  test('keeps every control row in the market column on one content edge', () => {
    const sidebar = read('PublicMarketsSidebar.tsx')
    expect(sidebar).not.toMatch(/border-b[^"']*\bp-2\.5\b/u)
    expect(sidebar).toContain('<WorkbenchToolbar\n        layout="stacked"')
    // The category bar is the shared `MarketTabStrip` now; its content edge is still `px-3`.
    expect(sidebar).toMatch(/<MarketTabStrip[^>]*className="px-3"/u)
  })

  test('keeps popover and rail controls on the shared control scale', () => {
    // The stepper input keeps the Input primitive's own height token.
    expect(read('IndicatorSettingsPopover.tsx')).not.toMatch(/className="h-6 /)
    expect(readFileSync(new URL('../TradingChartTab.tsx', import.meta.url), 'utf8')).toContain(
      'h-[var(--chrome-control-md)]',
    )
  })
})
