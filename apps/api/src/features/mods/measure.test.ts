import { expect, test } from 'bun:test'
import type { ModSessionRead } from './contracts'
import { createMeasurer } from './measure'

test('usage is pushed after a turn when a unit moved, and not again when nothing did', async () => {
  const sent: unknown[] = []
  let read: ModSessionRead = { messages: [], model: 'm', context: { window: 1000, tokens: 250 } }
  const measure = createMeasurer({
    read: async () => read,
    dispatch: async (_event, input) => void sent.push(input),
    hears: () => true,
  })
  const scene = { userId: 'u', sessionId: 's', cwd: '/' }
  await measure(scene, new Set(['m']))
  await measure(scene, new Set(['m']))
  read = { ...read, costUsd: 0.5 }
  await measure(scene, new Set(['m']))
  expect(sent).toEqual([
    { context: { window: 1000, tokens: 250, percent: 25 }, rateLimits: [], changed: ['context'] },
    {
      context: { window: 1000, tokens: 250, percent: 25 },
      rateLimits: [],
      cost: { usd: 0.5 },
      changed: ['cost'],
    },
  ])
})
