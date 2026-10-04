import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('warm-hidden Trading work items', () => {
  test('contribution adapters pass grid visibility to every Trading surface', () => {
    const registration = read('./register.tsx')

    expect(registration).toContain('function TradingWorkspaceBody({ item, visible }')
    expect(registration).toContain(
      '<TradingWorkspaceLazy sessionId={sessionId} requestedArea={requestedArea} active={visible} />',
    )
    expect(registration).toMatch(
      /function TradingChartBody\(\{\s*item,\s*visible,\s*publishMessageContext,/,
    )
    expect(registration).toMatch(
      /function TradingTechnicalsBody\(\{\s*item,\s*visible,\s*publishMessageContext,/,
    )
    expect(registration.match(/active=\{visible\}/g)).toHaveLength(3)
  })

  test('the root workspace parks both hidden work items and visited inactive areas', () => {
    const workspace = read('./TradingWorkspace.tsx')
    const overview = read('./TradingOverview.tsx')
    const markets = read('./ui/PublicMarketsSidebar.tsx')

    expect(workspace).toContain("active={active && area === 'overview'}")
    expect(workspace).toContain("active={active && area === 'markets'}")
    expect(overview).toContain('if (!active) return')
    expect(markets).toContain('const markets = useMarkets(sourceId, active,')
  })

  test('chart and technicals park one-shot reads as well as pollers and streams', () => {
    const chart = read('./TradingChartTab.tsx')
    const technicals = read('./TechnicalsTab.tsx')
    const funding = read('./model/useFunding.ts')
    const stream = read('./model/useTradingStream.ts')

    expect(chart).toContain('const dataActive = active && tabVisible')
    expect(chart.match(/if \(!dataActive\) return/g)).toHaveLength(2)
    expect(chart).toContain('{ enabled: dataActive }')
    expect(technicals).toContain('const dataActive = active && tabVisible')
    expect(technicals).toContain('useFunding(connectionId, symbol, dataActive)')
    expect(funding).toContain('if (!enabled || !isPerp)')
    expect(stream).toContain('const activeParams = workItemVisible ? params : null')
  })
})
