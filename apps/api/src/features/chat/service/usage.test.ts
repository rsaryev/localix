import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../contracts'
import type { UsageStatRow } from '../../usage/repository'
import { formatSessionUsage, formatSessionUsageFromTurns } from './usage'

type Usage = NonNullable<PersistedMessage['payload']['usage']>

const msg = (usage?: Partial<Usage>): PersistedMessage =>
  ({
    payload: { role: 'assistant', ...(usage ? { usage } : {}) },
  }) as unknown as PersistedMessage

describe('formatSessionUsage', () => {
  test('reports nothing when no message carries usage', () => {
    expect(formatSessionUsage([msg(), msg()])).toBe('No usage recorded yet for this session.')
  })

  test('counts only turns that carry usage and sums their tokens', () => {
    const out = formatSessionUsage([
      msg({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 250 }),
      msg(), // no usage → skipped
      msg({ inputTokens: 1000, outputTokens: 300, cachedInputTokens: 250 }),
    ])
    expect(out).toContain('- Assistant turns: 2')
    // 500 cached / 2000 input = 25%; tokens rendered with thousands separators.
    expect(out).toContain('- Input tokens: 2,000 (500 cached, 25%)')
    expect(out).toContain('- Output tokens: 500')
    expect(out).toContain('- Total tokens: 2,500')
  })

  test('cache % never divides by zero when there is no input', () => {
    const out = formatSessionUsage([msg({ outputTokens: 10, cachedInputTokens: 0 })])
    expect(out).toContain('- Input tokens: 0 (0 cached, 0%)')
    expect(out).not.toContain('NaN')
  })

  test('uses the canonical provider total instead of recomputing a divergent total', () => {
    const out = formatSessionUsage([
      msg({ inputTokens: 10, outputTokens: 5, totalTokens: 19 }),
      msg({ inputTokens: 20, outputTokens: 7, totalTokens: 31 }),
    ])
    expect(out).toContain('- Total tokens: 50')
    expect(out).not.toContain('- Total tokens: 42')
  })

  test('cache-write and cost lines appear only when non-zero', () => {
    const without = formatSessionUsage([msg({ inputTokens: 10, outputTokens: 5 })])
    expect(without).not.toContain('Cache-write')
    expect(without).not.toContain('Estimated cost')

    const withExtras = formatSessionUsage([
      msg({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 7, totalCost: 0.01234 }),
    ])
    expect(withExtras).toContain('- Cache-write tokens: 7')
    expect(withExtras).toContain('- Estimated cost: $0.0123')
  })

  test('all-subscription session shows plan usage, not metered spend', () => {
    const out = formatSessionUsage([
      msg({ inputTokens: 100, outputTokens: 5, totalCost: 0.5, costSource: 'subscription' }),
      msg({ inputTokens: 100, outputTokens: 5, totalCost: 0.7, costSource: 'subscription' }),
    ])
    expect(out).toContain('- Plan usage: ~$1.2000 (subscription')
    expect(out).not.toContain('- Estimated cost:')
  })

  test('mixed metered + subscription separates the plan estimate', () => {
    const out = formatSessionUsage([
      msg({ inputTokens: 100, outputTokens: 5, totalCost: 0.3, costSource: 'actual' }),
      msg({ inputTokens: 100, outputTokens: 5, totalCost: 0.5, costSource: 'subscription' }),
    ])
    expect(out).toContain(
      '- Estimated cost: $0.8000 (incl. ~$0.5000 subscription plan, not metered)',
    )
  })

  test('adds auxiliary ledger calls but ignores duplicate turn aggregates', () => {
    const out = formatSessionUsage(
      [msg({ inputTokens: 100, outputTokens: 5, totalTokens: 105, totalCost: 0.1 })],
      [
        {
          key: 'turn',
          inputTokens: 100,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0,
          reasoningTokens: 0,
          totalTokens: 105,
          costUsd: 0.1,
          messages: 1,
          actualCostMessages: 1,
          subscriptionMessages: 0,
          subscriptionCostUsd: 0,
        },
        {
          key: 'compaction',
          inputTokens: 40,
          outputTokens: 10,
          cacheReadTokens: 20,
          cacheWriteTokens: 2,
          cacheWrite1hTokens: 1,
          reasoningTokens: 0,
          totalTokens: 50,
          costUsd: 0.02,
          messages: 1,
          actualCostMessages: 1,
          subscriptionMessages: 0,
          subscriptionCostUsd: 0,
        },
      ],
    )
    expect(out).toContain('- Assistant turns: 1')
    expect(out).toContain('- Auxiliary model calls: 1')
    expect(out).toContain('- Input tokens: 140 (20 cached, 14%)')
    expect(out).toContain('- Total tokens: 155')
    expect(out).toContain('- Estimated cost: $0.1200')
  })

  test('renders a covering projection exactly like hydrated messages', () => {
    const messages = [
      msg({
        inputTokens: 100,
        outputTokens: 5,
        totalTokens: 105,
        totalCost: 0.3,
        costSource: 'actual',
      }),
      msg({
        inputTokens: 100,
        outputTokens: 5,
        cachedInputTokens: 40,
        cacheWriteTokens: 2,
        totalTokens: 105,
        totalCost: 0.5,
        costSource: 'subscription',
      }),
    ]
    const ledgerByKind: UsageStatRow[] = [
      {
        key: 'turn',
        inputTokens: 200,
        outputTokens: 10,
        cacheReadTokens: 40,
        cacheWriteTokens: 2,
        cacheWrite1hTokens: 0,
        reasoningTokens: 0,
        totalTokens: 210,
        costUsd: 0.8,
        messages: 2,
        actualCostMessages: 1,
        subscriptionMessages: 1,
        subscriptionCostUsd: 0.5,
      },
      {
        key: 'compaction',
        inputTokens: 40,
        outputTokens: 10,
        cacheReadTokens: 20,
        cacheWriteTokens: 3,
        cacheWrite1hTokens: 1,
        reasoningTokens: 0,
        totalTokens: 50,
        costUsd: 0.02,
        messages: 1,
        actualCostMessages: 0,
        subscriptionMessages: 1,
        subscriptionCostUsd: 0.02,
      },
    ]

    expect(
      formatSessionUsageFromTurns(
        {
          turns: 2,
          subscriptionCost: 0.5,
          usage: {
            inputTokens: 200,
            outputTokens: 10,
            cachedInputTokens: 40,
            cacheWriteTokens: 2,
            totalTokens: 210,
            totalCost: 0.8,
            costSource: 'estimated',
            isSummary: true,
          },
        },
        ledgerByKind,
      ),
    ).toBe(formatSessionUsage(messages, ledgerByKind))
  })
})
