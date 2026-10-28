import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionUsageIndicator } from './SessionUsageIndicator'
import { UsageTotals } from './UsageTotals'

test('the header usage icon keeps amounts in the hover details', () => {
  const markup = renderToStaticMarkup(
    <SessionUsageIndicator
      usage={{
        totalTokens: 9900,
        totalCost: 0.09,
        costSource: 'subscription',
        contextTokens: 2000,
      }}
    />,
  )
  expect(markup).toContain('Total session usage')
  expect(markup).toContain('<svg')
  expect(markup).not.toContain('>Usage<')
  expect(markup).not.toContain('9.9k')
  expect(markup).not.toContain('$0.09')
  expect(markup).not.toContain('%')
  expect(markup).not.toContain('Context usage')
  expect(renderToStaticMarkup(<SessionUsageIndicator />)).toBe('')
})

test('usage details distinguish missing data and subscription estimates', () => {
  expect(renderToStaticMarkup(<UsageTotals />)).toContain('No recorded usage yet')
  const markup = renderToStaticMarkup(
    <UsageTotals
      usage={{
        inputTokens: 100,
        cachedInputTokens: 30,
        cacheWriteTokens: 20,
        outputTokens: 10,
        totalTokens: 110,
        totalCost: 0.1,
        costSource: 'subscription',
      }}
    />,
  )
  expect(markup).toContain('Cost (plan, est.)')
  expect(markup).toContain('Uncached input')
  expect(markup).toContain('>50<')
})
