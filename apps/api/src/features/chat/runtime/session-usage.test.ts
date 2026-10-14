import { describe, expect, test } from 'bun:test'

import { publishSessionUsageSnapshot } from './session-usage'

const row = (totalTokens: number) => ({
  key: 'compaction',
  inputTokens: totalTokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  reasoningTokens: 0,
  totalTokens,
  costUsd: 0,
  messages: 1,
  actualCostMessages: 0,
  subscriptionMessages: 0,
  subscriptionCostUsd: 0,
})

describe('publishSessionUsageSnapshot', () => {
  test('a slower old query cannot overwrite a newer auxiliary total', async () => {
    let releaseOld!: (rows: ReturnType<typeof row>[]) => void
    const oldRows = new Promise<ReturnType<typeof row>[]>((resolve) => {
      releaseOld = resolve
    })
    let call = 0
    const usageRepo = {
      queryStats: () => (++call === 1 ? oldRows : Promise.resolve([row(20)])),
    }
    const published: Array<{ usage?: { totalTokens?: number } | null }> = []
    const args = {
      repo: { getActiveBranchUsage: async () => ({ turns: 0, subscriptionCost: 0 }) },
      usageRepo: usageRepo as never,
      streamRegistry: {
        publish: (_userId: string, _sessionId: string, event: (typeof published)[number]) =>
          published.push(event),
      } as never,
      userId: 'u',
      sessionId: 's',
    }

    const old = publishSessionUsageSnapshot(args)
    await publishSessionUsageSnapshot(args)
    releaseOld([row(10)])
    await old

    expect(published.map((event) => event.usage?.totalTokens)).toEqual([20])
  })

  test('does not revive an old snapshot across a completed request and a new request', async () => {
    let releaseOld!: (rows: ReturnType<typeof row>[]) => void
    let releaseNewest!: (rows: ReturnType<typeof row>[]) => void
    const oldRows = new Promise<ReturnType<typeof row>[]>((resolve) => {
      releaseOld = resolve
    })
    const newestRows = new Promise<ReturnType<typeof row>[]>((resolve) => {
      releaseNewest = resolve
    })
    let call = 0
    const usageRepo = {
      queryStats: () => {
        call += 1
        if (call === 1) return oldRows
        if (call === 2) return Promise.resolve([row(20)])
        return newestRows
      },
    }
    const published: Array<{ usage?: { totalTokens?: number } | null }> = []
    const args = {
      repo: { getActiveBranchUsage: async () => ({ turns: 0, subscriptionCost: 0 }) },
      usageRepo: usageRepo as never,
      streamRegistry: {
        publish: (_userId: string, _sessionId: string, event: (typeof published)[number]) =>
          published.push(event),
      } as never,
      userId: 'u',
      sessionId: 's-aba',
    }

    const old = publishSessionUsageSnapshot(args)
    await publishSessionUsageSnapshot(args)
    const newest = publishSessionUsageSnapshot(args)
    releaseOld([row(10)])
    await old
    releaseNewest([row(30)])
    await newest

    expect(published.map((event) => event.usage?.totalTokens)).toEqual([20, 30])
  })

  test('combines the covering active-branch turn summary with auxiliary usage', async () => {
    const published: Array<{ usage?: { totalTokens?: number } | null }> = []
    await publishSessionUsageSnapshot({
      repo: {
        getActiveBranchUsage: async () => ({
          turns: 2,
          subscriptionCost: 0,
          usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40, isSummary: true },
        }),
      },
      usageRepo: {
        queryStats: async () => [row(5)],
      } as never,
      streamRegistry: {
        publish: (_userId: string, _sessionId: string, event: (typeof published)[number]) =>
          published.push(event),
      } as never,
      userId: 'u',
      sessionId: 'covering',
    })

    expect(published[0]?.usage).toMatchObject({
      inputTokens: 35,
      outputTokens: 10,
      totalTokens: 45,
      isSummary: true,
    })
  })
})
