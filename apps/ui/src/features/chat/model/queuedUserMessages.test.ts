import { expect, test } from 'bun:test'

import { withoutQueuedUserMessages } from './queuedUserMessages'

const messages = [{ id: 'm1' }, { id: 'optimistic-a' }, { id: 'optimistic-b' }]

test('a message still waiting in the queue stays out of the transcript', () => {
  const queue = [{ kind: 'user' as const, clientMessageId: 'optimistic-b' }]
  expect(withoutQueuedUserMessages(messages, queue).map((m) => m.id)).toEqual([
    'm1',
    'optimistic-a',
  ])
})

test('it enters when the queue lets it go, and wakes never hide a row', () => {
  expect(withoutQueuedUserMessages(messages, [])).toBe(messages)
  expect(withoutQueuedUserMessages(messages, undefined)).toBe(messages)
  const wake = [{ kind: 'wake' as const, clientMessageId: 'optimistic-a' }]
  expect(withoutQueuedUserMessages(messages, wake)).toBe(messages)
})
