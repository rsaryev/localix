import { describe, expect, test } from 'bun:test'
// Web-only summary projection and point-detail contract.
import type { AgentItem, ToolBackedItem } from '@localixai/agent/agents'

import type { PersistedMessage } from '../contracts'
import type { SessionDetailContext } from './session-detail'
import { deferCollapsedToolDetails, getMessageToolDetails } from './session-detail'

const tool = (id: string, over: Partial<ToolBackedItem> = {}): ToolBackedItem =>
  ({
    id,
    type: 'tool_call',
    status: 'completed',
    toolCallId: `call-${id}`,
    name: 'read',
    activeVerb: 'Reading',
    input: { path: `${id}.ts`, body: 'input detail' },
    resultText: 'result detail',
    output: { output: 'rich detail' },
    sources: [
      {
        kind: 'web',
        uri: `https://example.com/${id}`,
        title: id,
        status: 'available',
        role: 'consulted',
      },
    ],
    ...over,
  }) as ToolBackedItem

const message = (items: AgentItem[]): PersistedMessage =>
  ({
    id: 'message-a',
    sessionId: 'session-a',
    userId: 'user-a',
    payload: { role: 'assistant', items },
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  }) as PersistedMessage

describe('deferCollapsedToolDetails', () => {
  test('keeps collapsed summary identity and sources while removing card-only fields', () => {
    const original = message([tool('one'), tool('two')])

    const projected = deferCollapsedToolDetails([original])[0]!
    const first = projected.payload.items?.[0] as ToolBackedItem

    expect(projected.deferredToolItemIds).toEqual(['one', 'two'])
    expect(first).toMatchObject({
      id: 'one',
      type: 'tool_call',
      status: 'completed',
      toolCallId: 'call-one',
      name: 'read',
      activeVerb: 'Reading',
      sources: [{ uri: 'https://example.com/one' }],
    })
    expect(first.input).toBeUndefined()
    expect(first.resultText).toBeUndefined()
    expect(first.type === 'tool_call' ? first.output : null).toBeUndefined()
    // Projection must not mutate the full row used for timing, usage or replay.
    expect((original.payload.items?.[0] as ToolBackedItem | undefined)?.resultText).toBe(
      'result detail',
    )
  })

  test('keeps lone, live, standalone and serialized-navigation items full', () => {
    const navigation = tool('navigation', {
      output: { type: 'ui.navigate', uri: 'localix://ui/settings/tools', label: 'Settings' },
    })
    const inputs = [
      message([tool('lone')]),
      message([tool('done'), tool('live', { status: 'running' })]),
      message([
        tool('extension-surface', { name: 'extension_surface', standalone: true }),
        tool('after-extension'),
      ]),
      message([navigation, tool('after-navigation')]),
    ]

    const projected = deferCollapsedToolDetails(inputs)

    expect(projected.every((row) => row.deferredToolItemIds === undefined)).toBe(true)
    expect(
      projected.map((row) => (row.payload.items?.[0] as ToolBackedItem | undefined)?.resultText),
    ).toEqual(['result detail', 'result detail', 'result detail', 'result detail'])
  })

  test('retains file diffs that drive the collapsed aggregate', () => {
    const change: ToolBackedItem = {
      id: 'change',
      type: 'file_change',
      status: 'completed',
      toolCallId: 'call-change',
      name: 'apply_patch',
      changes: [{ path: 'a.ts', kind: 'modify', diff: '@@\n-old\n+new' }],
    }

    const projected = deferCollapsedToolDetails([message([change, tool('read')])])[0]!

    expect(projected.deferredToolItemIds).toEqual(['read'])
    expect((projected.payload.items?.[0] as typeof change | undefined)?.changes[0]?.diff).toContain(
      '+new',
    )
  })

  test('cuts a synthetic collapsed message by more than 99 percent', () => {
    const large = 'x'.repeat(300_000)
    const original = message([
      tool('one', { resultText: large, output: { output: large } }),
      tool('two', { resultText: large, output: { output: large } }),
    ])
    const before = JSON.stringify(original).length
    const after = JSON.stringify(deferCollapsedToolDetails([original])[0]).length

    expect(before).toBeGreaterThan(1_000_000)
    expect(after).toBeLessThan(before / 100)
  })
})

describe('getMessageToolDetails', () => {
  test('point-reads the exact owner/session/message and returns only tool items', async () => {
    const calls: unknown[][] = []
    const full = message([
      { id: 'text', type: 'text', status: 'completed', text: 'answer' },
      tool('one'),
    ])
    const ctx = {
      repo: {
        getMessage: async (...args: unknown[]) => {
          calls.push(args)
          return full
        },
      },
    } as unknown as SessionDetailContext

    const details = await getMessageToolDetails(ctx, 'user-a', 'session-a', 'message-a')

    expect(calls).toEqual([['user-a', 'session-a', 'message-a']])
    expect(details.items.map((item) => item.id)).toEqual(['one'])
    expect(details.items[0]?.resultText).toBe('result detail')
  })

  test('does not reveal whether a foreign or absent message exists', async () => {
    const ctx = {
      repo: { getMessage: async () => null },
    } as unknown as SessionDetailContext

    expect(getMessageToolDetails(ctx, 'other', 'session-a', 'message-a')).rejects.toMatchObject({
      status: 404,
      code: 'message_not_found',
    })
  })
})
