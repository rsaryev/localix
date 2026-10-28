import { describe, expect, test } from 'bun:test'

import { statusLineUsage } from './status-line-usage'

/** What the status line reads of a conversation: the last request's context, the prompt, the cache. */
const request = {
  inputTokens: 20_000,
  outputTokens: 500,
  cacheReadTokens: 12_000,
  cacheWriteTokens: 3_000,
}

const message = (id: string, role: 'user' | 'assistant', extra: Record<string, unknown> = {}) => ({
  id,
  payload: { role, ...extra },
})

function read(
  messages: Array<ReturnType<typeof message> & { updatedAt?: string }>,
  options: { checkpoints?: string[]; branch?: unknown } = {},
) {
  return statusLineUsage(
    {
      getActiveBranchUsage: async () =>
        (options.branch ?? { turns: 0, subscriptionCost: 0 }) as never,
      listRecentVisibleMessages: async () => ({ messages, hasMore: false }) as never,
    },
    {
      list: async (_session, ids) =>
        new Map(
          ids.map((id) => [
            id,
            { messageId: id, hasCheckpoint: options.checkpoints?.includes(id) ?? false },
          ]),
        ),
    },
    'u1',
    'S-1',
  )
}

describe('the usage a status line reads', () => {
  test('the newest request, the prompt being answered and the window of the run', async () => {
    const usage = await read([
      message('a2', 'assistant', {
        dataParts: [{ type: 'data-context-window', data: { fullWindowTokens: 200_000 } }],
      }),
      message('u2', 'user'),
      message('a1', 'assistant', { usage: { lastRequest: request } }),
    ])
    expect(usage).toMatchObject({ lastRequest: request, promptId: 'u2', contextSize: 200_000 })
    expect(usage.compacted).toBeUndefined()
  })

  test('a checkpoint taken after the last request leaves no request until the next one', async () => {
    const usage = await read(
      [message('a2', 'assistant'), message('a1', 'assistant', { usage: { lastRequest: request } })],
      { checkpoints: ['a2'] },
    )
    expect(usage.lastRequest).toBeUndefined()
    expect(usage.compacted).toBe(true)

    const after = await read([message('a2', 'assistant', { usage: { lastRequest: request } })], {
      checkpoints: ['a2'],
    })
    expect(after.lastRequest).toEqual(request)
  })

  test('the cache lifetime runs from when the run ended, which a later patch of the row does not move', async () => {
    const started = '2026-10-25T20:27:20.997Z'
    const row = (updatedAt: string, extra: Record<string, unknown> = {}) => ({
      ...message('a1', 'assistant', {
        usage: { lastRequest: request },
        timing: { totalMs: 23_104 },
        ...extra,
      }),
      createdAt: started,
      updatedAt,
    })
    const branch = (usage: Record<string, unknown>) => ({
      branch: { turns: 1, subscriptionCost: 0, usage: { inputTokens: 20_000, ...usage } },
    })
    // A delegate's result landing a minute later rewrites the row; the response is still as old.
    const usage = await read(
      [row('2026-10-25T20:28:44.105Z')],
      branch({ cachedInputTokens: 12_000, cacheWrite1hTokens: 3_000 }),
    )
    expect(usage.cache).toMatchObject({
      lastResponseAt: Date.parse(started) + 23_104,
      longLived: true,
    })
    // Without a timing (a run still settling) the row's own time stands in.
    const untimed = await read(
      [{ ...row('2026-10-25T20:27:50.000Z', { timing: undefined }) }],
      branch({ cachedInputTokens: 12_000 }),
    )
    expect(untimed.cache?.lastResponseAt).toBe(Date.parse('2026-10-25T20:27:50.000Z'))
    expect(untimed.cache?.longLived).toBeFalsy()
  })

  test('the cache, from the counts the responses reported', async () => {
    const usage = await read([], {
      branch: {
        turns: 2,
        subscriptionCost: 0,
        usage: {
          inputTokens: 40_000,
          cachedInputTokens: 30_000,
          cacheWriteTokens: 5_000,
          totalCost: 0.5,
        },
      },
    })
    expect(usage).toMatchObject({
      totalCost: 0.5,
      cache: { hitRatio: 0.75, writeTokens: 5_000, observed: true },
    })
    expect((await read([])).cache).toBeUndefined()
  })
})
