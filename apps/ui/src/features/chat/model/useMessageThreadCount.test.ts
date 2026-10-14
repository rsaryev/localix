import { describe, expect, test } from 'bun:test'
import type { ChatStore } from './store'
import { messageThreadCount } from './useMessageThreadCount'

describe('messageThreadCount', () => {
  test('indexes each roster identity once for every mounted message card', () => {
    let scans = 0
    const rows = [
      { id: 'thread-1', sourceToolCallId: 'message-thread:m1', messageCount: 3 },
      { id: 'thread-2', sourceToolCallId: 'message-thread:m2', messageCount: 7 },
      { id: 'chat', sourceToolCallId: null, messageCount: 20 },
    ] as ChatStore['allSessions']
    const roster = new Proxy(rows, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) scans += 1
        return Reflect.get(target, property, receiver)
      },
    })

    expect(messageThreadCount(roster, 'm1')).toBe(3)
    expect(messageThreadCount(roster, 'm2')).toBe(7)
    expect(messageThreadCount(roster, 'missing')).toBe(0)
    expect(scans).toBe(1)

    expect(messageThreadCount([...roster], 'm1')).toBe(3)
    expect(scans).toBe(2)
  })
})
