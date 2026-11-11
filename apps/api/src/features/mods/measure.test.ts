import { expect, test } from 'bun:test'
import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import type { ModSessionRead } from './contracts'
import { createMeasurer } from './measure'

test('usage is pushed after a turn when a unit moved, and not again when nothing did', async () => {
  const sent: unknown[] = []
  let read: ModSessionRead = { messages: [], model: 'm', context: { window: 1000, tokens: 250 } }
  const measure = createMeasurer({ read: async () => read })
  // A kit host whose chain hears the event and keeps each input it is fired with.
  const kit = {
    chain: { hears: () => true },
    fire: async (_event: string, input: unknown) => void sent.push(input),
  } as unknown as KitModsHost
  const scope = { kit, scene: { userId: 'u', sessionId: 's', cwd: '/' } }
  await measure(scope)
  await measure(scope)
  read = { ...read, costUsd: 0.5 }
  await measure(scope)
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
