import { expect, test } from 'bun:test'

import { recoveredUsage } from './recovered-usage'

test.each([
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'cacheWrite1hTokens',
  'reasoningTokens',
  'totalTokens',
  'totalCost',
])('rejects a negative persisted accounting field instead of inventing a zero: %s', (key) => {
  expect(recoveredUsage(JSON.stringify({ usage: { inputTokens: 5, [key]: -1 } }))).toBeNull()
})

test.each([
  '{',
  'null',
  '[]',
  '{}',
  '{"usage":[]}',
  '{"usage":{"inputTokens":1e400}}',
  '{"usage":{"costSource":"unknown"}}',
])('rejects malformed or unsupported accounting: %s', (payload) => {
  expect(recoveredUsage(payload)).toBeNull()
})

test('preserves valid accounting and message attribution while ignoring malformed optional timing', () => {
  const recovered = recoveredUsage(
    JSON.stringify({
      usage: { inputTokens: 0, outputTokens: 2, totalCost: 0, costSource: 'subscription' },
      providerMeta: { providerId: 'provider', modelId: 'model', keyLabel: '', keyMasked: 'masked' },
      from: { agentId: 'speaker' },
      timing: { modelMs: -1 },
    }),
  )
  expect(recovered).toMatchObject({
    inputTokens: 0,
    outputTokens: 2,
    totalCost: 0,
    costSource: 'subscription',
    providerId: 'provider',
    modelId: 'model',
    keyLabel: undefined,
    keyMasked: 'masked',
    agentId: 'speaker',
    modelMs: undefined,
    totalTokens: undefined,
  })
})
