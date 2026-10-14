import { expect, test } from 'bun:test'

import { insertColumns, mutableColumns } from './usage-event-columns'
import type { UsageEventInput } from './usage-types'

const event: UsageEventInput = Object.freeze({
  messageId: 'message',
  sessionId: 'session',
  userId: 'user',
  modelId: 'provider/model',
})

test('insertion retains identity while update columns contain only mutable accounting and attribution', () => {
  const update = mutableColumns(event)
  expect(update).toMatchObject({
    provider_id: null,
    model_id: 'provider/model',
    input_tokens: 0,
    cost_usd: 0,
    cost_source: 'estimated',
    duration_ms: null,
    agent_id: null,
  })
  expect(Object.hasOwn(update, 'message_id')).toBe(false)
  expect(Object.hasOwn(update, 'session_id')).toBe(false)
  expect(Object.hasOwn(update, 'created_at')).toBe(false)
  expect(insertColumns(event)).toEqual({
    ...update,
    message_id: 'message',
    session_id: 'session',
    root_session_id: null,
    user_id: 'user',
    provider_connection_id: null,
  })
})

test.each([
  ['2026-01-01T03:04:05+02:00', '2026-01-01 01:04:05'],
  ['2026-01-01 03:04:05', '2026-01-01 03:04:05'],
  ['invalidTdate', undefined],
  ['', undefined],
])('insertion preserves the original timestamp policy: %s', (createdAt, expected) => {
  const columns = insertColumns({ ...event, createdAt })
  expect('created_at' in columns ? columns.created_at : undefined).toBe(expected)
  expect(Object.hasOwn(columns, 'created_at')).toBe(expected !== undefined)
})

test('explicit zero values and subscription cost retain their meaning', () => {
  const columns = mutableColumns(
    Object.freeze({
      ...event,
      durationMs: 0,
      costUsd: 0,
      costSource: 'subscription',
      keyLabel: '',
      keyMasked: '',
      agentId: 'speaker',
    }),
  )
  expect(columns).toMatchObject({
    duration_ms: 0,
    cost_usd: 0,
    cost_source: 'subscription',
    key_label: '',
    key_masked: '',
    agent_id: 'speaker',
  })
})
