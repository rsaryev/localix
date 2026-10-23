import { describe, expect, it } from 'bun:test'
import {
  normalizeUsage,
  providerIdFromModel,
  recordAuxCallUsage,
  recordTitleGenUsage,
  usageEventFields,
  zeroUsageTotals,
} from './usage-normalize'

describe('zeroUsageTotals', () => {
  it('returns the canonical zeroed usage aggregate', () => {
    expect(zeroUsageTotals()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    })
  })
})

describe('recordAuxCallUsage', () => {
  it('keeps separate rows when the aux routing identity changes', async () => {
    const events: Array<Record<string, unknown>> = []
    const usageRepo = {
      accumulateEvent: async (event: Record<string, unknown>) => {
        events.push(event)
      },
    }
    const record = (modelId: string, providerConnectionId: string) =>
      recordAuxCallUsage({
        usageRepo: usageRepo as never,
        userId: 'u',
        sessionId: 's',
        kind: 'inline-completion',
        modelId,
        providerConnectionId,
        usage: { inputTokens: 10, outputTokens: 2 },
      })

    record('openai/gpt-5.6', 'openai-oauth')
    record('openai/gpt-5.6', 'openai-oauth')
    record('anthropic/claude-next', 'anthropic-oauth')
    await Promise.resolve()

    expect(events[0]?.messageId).toBe(events[1]?.messageId)
    expect(events[2]?.messageId).not.toBe(events[0]?.messageId)
    expect(events[0]).toMatchObject({
      providerConnectionId: 'openai-oauth',
      modelId: 'openai/gpt-5.6',
    })
    expect(events[2]).toMatchObject({
      providerConnectionId: 'anthropic-oauth',
      modelId: 'anthropic/claude-next',
    })
  })

  it('uses the resolver provider for a bare model id', async () => {
    const events: Array<Record<string, unknown>> = []
    recordAuxCallUsage({
      usageRepo: {
        accumulateEvent: async (event: Record<string, unknown>) => {
          events.push(event)
        },
      } as never,
      userId: 'u',
      sessionId: 's',
      kind: 'inline-completion',
      modelId: 'shared-model',
      providerConnectionId: 'provider-b-key',
      providerId: 'provider-b',
      usage: { inputTokens: 10, outputTokens: 2 },
    })
    await Promise.resolve()

    expect(events[0]).toMatchObject({
      providerConnectionId: 'provider-b-key',
      providerId: 'provider-b',
      modelId: 'shared-model',
    })
  })
})

describe('recordTitleGenUsage', () => {
  it('accumulates retries per routing identity and separates a changed title model', async () => {
    const events: Array<Record<string, unknown>> = []
    const usageRepo = {
      accumulateEvent: async (event: Record<string, unknown>) => {
        events.push(event)
      },
    }
    const record = (modelId: string, providerConnectionId: string, totalTokens: number) =>
      recordTitleGenUsage({
        usageRepo: usageRepo as never,
        userId: 'u',
        sessionId: 's',
        modelId,
        providerConnectionId,
        usage: { totalTokens },
      })

    record('openai/gpt-title', 'openai-oauth', 10)
    record('openai/gpt-title', 'openai-oauth', 12)
    record('anthropic/claude-title', 'anthropic-oauth', 15)
    await Promise.resolve()

    expect(events[0]?.messageId).toBe(events[1]?.messageId)
    expect(events[2]?.messageId).not.toBe(events[0]?.messageId)
    expect(events.map((event) => event.finishReason)).toEqual(['title', 'title', 'title'])
  })
})

describe('normalizeUsage', () => {
  it('fills missing fields with zeroes and derives totalTokens', () => {
    expect(normalizeUsage({ inputTokens: 7, outputTokens: 5 })).toEqual({
      inputTokens: 7,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 0,
      totalTokens: 12,
      totalCost: 0,
      costSource: 'estimated',
    })
  })

  it('clamps the one-hour subset to total cache writes', () => {
    expect(normalizeUsage({ cacheWriteTokens: 5, cacheWrite1hTokens: 8 })).toMatchObject({
      cacheWriteTokens: 5,
      cacheWrite1hTokens: 5,
    })
  })

  it('preserves explicit totals and cost provenance', () => {
    expect(
      normalizeUsage({
        totalTokens: 42,
        totalCost: 1.25,
        costSource: 'actual',
      }),
    ).toMatchObject({
      totalTokens: 42,
      totalCost: 1.25,
      costSource: 'actual',
    })
  })

  it('sanitizes malformed provider accounting before it reaches the ledger', () => {
    expect(
      normalizeUsage({
        inputTokens: 8,
        outputTokens: -2,
        cacheReadTokens: Number.NaN,
        cacheWriteTokens: Number.POSITIVE_INFINITY,
        totalTokens: -1,
        totalCost: Number.NaN,
        costSource: 'unknown',
      }),
    ).toMatchObject({
      inputTokens: 8,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      totalTokens: 8,
      totalCost: 0,
      costSource: 'estimated',
    })
  })
})

describe('providerIdFromModel', () => {
  it('returns the provider prefix from a slash-delimited model id', () => {
    expect(providerIdFromModel('openai/gpt-5.4')).toBe('openai')
  })

  it('does not invent a provider from a raw model id', () => {
    expect(providerIdFromModel('gpt-5.4')).toBeNull()
    expect(providerIdFromModel('/gpt-5.4')).toBeNull()
    expect(providerIdFromModel('')).toBeNull()
  })
})

describe('usageEventFields', () => {
  it('maps normalized usage into ledger fields', () => {
    expect(usageEventFields({ inputTokens: 3, outputTokens: 2, reasoningTokens: 9 })).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 9,
      totalTokens: 5,
      costUsd: 0,
      costSource: 'estimated',
    })
  })
})
