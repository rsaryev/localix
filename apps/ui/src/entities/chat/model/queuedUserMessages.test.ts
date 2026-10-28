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

// A message sent mid-run showed in the transcript for the round trip it
// took the server to report the queue item, then vanished. It is held back from the first frame.
test('a message sent while a run was active stays out of the transcript before the queue reports it', () => {
  const rows = [{ id: 'm1' }, { id: 'optimistic-a', awaitsQueue: true }]
  expect(withoutQueuedUserMessages(rows, []).map((m) => m.id)).toEqual(['m1'])
})
