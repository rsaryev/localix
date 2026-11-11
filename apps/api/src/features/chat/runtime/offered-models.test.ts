import { expect, test } from 'bun:test'

import { offeredModelIds } from './offered-models'

const models = [
  { id: 'gpt-4o', providerId: 'openai' },
  { id: '302ai/claude-haiku-5-5', providerId: '302ai' },
  { id: 'claude-haiku-4-5', providerId: 'anthropic' },
]
const key = (enabled: boolean) => ({ enabled, priority: 0 })

// An agent file's `model: haiku` routes to the newest haiku a provider offers; a model of a provider
// the person never connected (or whose keys are all off) is not offered, so the child is not sent to it.
test('only models of a provider with an enabled key are offered', () => {
  const connections = [
    { providerId: 'openai', keys: [key(true)] },
    { providerId: 'anthropic', keys: [key(false)] },
  ]
  expect(offeredModelIds(models, connections)).toEqual(['gpt-4o'])
})

test('a connected provider with an enabled key offers its models', () => {
  const connections = [{ providerId: 'anthropic', keys: [key(false), key(true)] }]
  expect(offeredModelIds(models, connections)).toEqual(['claude-haiku-4-5'])
})
