import { describe, expect, test } from 'bun:test'

import { buildCallOptions, type WireProfile } from './prompt'

const anthropic: WireProfile = { namespace: 'anthropic', cacheBreakpoints: true, temperature: true }
const request = {
  systemPrompt: 's',
  messages: [{ role: 'user' as const, content: 'hi', timestamp: 0 }],
  tools: [],
}
const context = { sessionId: 's1', reasoningEffort: undefined, idleMs: undefined }
const cacheOf = (retention?: 'short' | 'long') =>
  buildCallOptions(request as never, anthropic, {
    ...context,
    ...(retention ? { cacheRetention: retention } : {}),
  }).prompt.map((message) => message.providerOptions)

// A run that asks for long retention (a Claude Code agent's `experimental.cacheTtl: 1h`) writes
// Anthropic's one-hour cache; short or unset keeps the default five-minute one.
describe('prompt cache retention', () => {
  test('long writes one-hour cache points', () => {
    expect(cacheOf('long')[0]).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
    })
  })

  test('short or unset keeps the default', () => {
    const plain = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    expect(cacheOf('short')[0]).toEqual(plain)
    expect(cacheOf()[0]).toEqual(plain)
  })
})
