import { describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'
import { areToolChainPropsEqual } from './ToolChain'

const item = (id: string): AgentItem =>
  ({ id, type: 'text', status: 'completed', text: id }) as AgentItem

describe('areToolChainPropsEqual', () => {
  test('compares activity records rather than freshly projected wrappers', () => {
    const activity = { id: 'activity', role: 'system' as const, content: 'Done' }
    expect(
      areToolChainPropsEqual(
        { items: [], activity: [activity] },
        { items: [], activity: [activity] },
      ),
    ).toBe(true)
    expect(
      areToolChainPropsEqual(
        { items: [], activity: [activity] },
        { items: [], activity: [{ ...activity, content: 'Changed' }] },
      ),
    ).toBe(false)
    expect(areToolChainPropsEqual({ items: [] }, { items: [], activity: [] })).toBe(true)
  })

  test('accepts fresh arrays containing the same immutable item references', () => {
    const first = item('first')
    const second = item('second')

    expect(areToolChainPropsEqual({ items: [first, second] }, { items: [first, second] })).toBe(
      true,
    )
  })

  test('rejects a replaced item reference', () => {
    const first = item('first')

    expect(areToolChainPropsEqual({ items: [first] }, { items: [item('first')] })).toBe(false)
  })

  test('rejects appended or removed items', () => {
    const first = item('first')
    const second = item('second')

    expect(areToolChainPropsEqual({ items: [first] }, { items: [first, second] })).toBe(false)
    expect(areToolChainPropsEqual({ items: [first, second] }, { items: [first] })).toBe(false)
  })

  test('rejects an isLatest transition', () => {
    const first = item('first')

    expect(
      areToolChainPropsEqual(
        { items: [first], isLatest: false },
        { items: [first], isLatest: true },
      ),
    ).toBe(false)
  })

  test('rejects a changed detail owner or deferred-id contract', () => {
    const first = item('first')

    expect(
      areToolChainPropsEqual(
        { items: [first], messageId: 'message-a' },
        { items: [first], messageId: 'message-b' },
      ),
    ).toBe(false)
    expect(
      areToolChainPropsEqual(
        { items: [first], deferredToolItemIds: ['first'] },
        { items: [first], deferredToolItemIds: [] },
      ),
    ).toBe(false)
  })
})
