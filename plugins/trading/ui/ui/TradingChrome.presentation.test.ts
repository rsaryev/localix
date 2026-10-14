import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const headerSource = readFileSync(new URL('./ChartHeader.tsx', import.meta.url), 'utf8')
const timeframeSource = readFileSync(new URL('./TimeframeBar.tsx', import.meta.url), 'utf8')
const sidePanelSource = readFileSync(new URL('./MarketSidePanel.tsx', import.meta.url), 'utf8')
const chartTabSource = readFileSync(new URL('../TradingChartTab.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('../TradingWorkspace.tsx', import.meta.url), 'utf8')

describe('Trading chart chrome', () => {
  test('uses the canonical compact workspace header measure', () => {
    expect(workspaceSource).toContain('<WorkbenchToolbar as="header"')
    expect(workspaceSource).not.toContain('border-b border-border-soft px-3 py-2')
  })

  test('keeps persistent quote and timeframe rows transparent', () => {
    expect(headerSource).not.toContain('bg-surface-raised/20')
    expect(timeframeSource).not.toContain('bg-surface-raised/10')
    expect(headerSource).toContain('border-b border-border-soft')
    // The timeframe row's seam is the kit toolbar's own (pinned by its test in the host).
    expect(timeframeSource).toContain('<WorkbenchToolbar')
  })

  test('separates the market side panel with geometry instead of a permanent tint', () => {
    expect(sidePanelSource).not.toContain('bg-surface-raised/10')
    expect(chartTabSource).not.toContain('bg-surface-raised/15')
    expect(chartTabSource).toContain('border-l border-border-soft')
    expect(chartTabSource).toContain('hover:bg-surface-hover/40')
  })
})
