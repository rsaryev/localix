import { describe, expect, test } from 'bun:test'
import {
  clearServerQueue,
  deleteServerQueueItem,
  returnNextQueuedMessage,
  returnServerQueueItem,
} from './queue-actions'

describe('server queue actions', () => {
  test('restores the complete content only after cancellation wins', async () => {
    const restored: Array<{ content: string; bindings?: unknown[] }> = []
    const content = 'x'.repeat(200)
    const bindings = [
      {
        kind: 'context' as const,
        id: 'r1',
        source: 'mention' as const,
        target: { kind: 'file', token: '@file:a.ts', label: 'a.ts' },
        resolution: { status: 'pending' as const, contributions: [] },
      },
    ]
    const result = await returnServerQueueItem({
      sessionId: 's1',
      itemId: 'q1',
      remove: async () => ({ removed: true, content, bindings }),
      restore: (message) => restored.push(message),
    })
    expect(result.removed).toBe(true)
    expect(restored).toEqual([{ content, bindings }])
  })

  test('cleans up transcript optimism only after explicit removal succeeds', async () => {
    const removed: string[] = []
    await returnServerQueueItem({
      sessionId: 's1',
      itemId: 'q1',
      remove: async () => ({ removed: true, content: 'draft' }),
      restore: () => {},
      onRemoved: () => removed.push('optimistic-user-1'),
    })
    expect(removed).toEqual(['optimistic-user-1'])

    await returnServerQueueItem({
      sessionId: 's1',
      itemId: 'q2',
      remove: async () => ({ removed: false, reason: 'leased' }),
      restore: () => {},
      onRemoved: () => removed.push('optimistic-user-2'),
    })
    expect(removed).toEqual(['optimistic-user-1'])
  })

  test('a leased row remains delivered and never duplicates into the composer', async () => {
    const restored: string[] = []
    const result = await returnServerQueueItem({
      sessionId: 's1',
      itemId: 'q1',
      remove: async () => ({ removed: false, reason: 'leased' }),
      restore: ({ content: text }) => restored.push(text),
    })
    expect(result).toEqual({ removed: false, reason: 'leased' })
    expect(restored).toEqual([])
  })

  test('deleting an internal wake never restores its trusted payload as user text', async () => {
    const removed: string[] = []
    const result = await deleteServerQueueItem({
      sessionId: 's1',
      itemId: 'wake-1',
      remove: async (_sessionId, itemId) => {
        removed.push(itemId)
        return { removed: true, content: 'trusted internal instruction' }
      },
    })
    expect(result).toEqual({
      removed: true,
      content: 'trusted internal instruction',
    })
    expect(removed).toEqual(['wake-1'])
  })

  test('clear reports rows already leased for delivery', async () => {
    expect(
      await clearServerQueue({
        sessionId: 's1',
        clear: async () => ({ removed: 2, retained: ['q3'] }),
      }),
    ).toEqual({ removed: 2, retained: ['q3'] })
  })

  test('Escape path is a no-op for empty, leased, and not_found queues', async () => {
    const restored: unknown[] = []
    const base = {
      sessionId: 's1',
      restore: (message: unknown) => restored.push(message),
    }
    expect(
      await returnNextQueuedMessage({
        ...base,
        serverQueue: [],
        removeServer: async () => ({ removed: false, reason: 'not_found' }),
      }),
    ).toBe('empty')
    for (const reason of ['leased', 'not_found'] as const) {
      expect(
        await returnNextQueuedMessage({
          ...base,
          serverQueue: [
            {
              id: 'q1',
              kind: 'user',
              priority: 0,
              preview: 'queued',
              queuedAt: '2026-07-20T00:00:00.000Z',
            },
          ],
          removeServer: async () => ({ removed: false, reason }),
        }),
      ).toBe(reason)
    }
    expect(restored).toEqual([])
  })

  test('Escape never turns an internal wake into user-authored composer text', async () => {
    let removals = 0
    const restored: unknown[] = []
    const outcome = await returnNextQueuedMessage({
      sessionId: 's1',
      serverQueue: [
        {
          id: 'wake-1',
          kind: 'wake',
          priority: 10,
          preview: 'trusted internal instruction',
          queuedAt: '2026-07-20T00:00:00.000Z',
          source: 'loop',
        },
      ],
      removeServer: async () => {
        removals += 1
        return { removed: true, content: 'trusted internal instruction' }
      },
      restore: (message) => restored.push(message),
    })

    expect(outcome).toBe('not_returnable')
    expect(removals).toBe(0)
    expect(restored).toEqual([])
  })

  test('Escape skips internal wakes and returns the first editable queue row', async () => {
    const removed: string[] = []
    const restored: string[] = []
    const outcome = await returnNextQueuedMessage({
      sessionId: 's1',
      serverQueue: [
        {
          id: 'wake-1',
          kind: 'wake',
          priority: 10,
          preview: 'trusted internal instruction',
          queuedAt: '2026-07-20T00:00:00.000Z',
          source: 'loop',
        },
        {
          id: 'user-1',
          kind: 'user',
          priority: 0,
          preview: 'operator text',
          queuedAt: '2026-07-20T00:00:01.000Z',
        },
      ],
      removeServer: async (_sessionId, itemId) => {
        removed.push(itemId)
        return { removed: true, content: 'operator text' }
      },
      restore: ({ content }) => restored.push(content),
    })

    expect(outcome).toBe('returned')
    expect(removed).toEqual(['user-1'])
    expect(restored).toEqual(['operator text'])
  })
})
