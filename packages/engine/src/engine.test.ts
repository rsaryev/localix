import { describe, expect, test } from 'bun:test'

import { createEngine } from './engine'

describe('the engine', () => {
  test('a model it cannot open fails the run with the reason, and settles', async () => {
    const engine = createEngine()
    const run = engine.runtime.run({
      sessionId: 's1',
      model: { providerId: 'openai', modelId: 'no-such-model' },
      credential: { kind: 'none' } as never,
      systemPrompt: 'be brief',
      messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
      tools: [],
    })
    const types: string[] = []
    // A failed run hands its error to the consumer too, after the events that led to it.
    const thrown = await (async () => {
      for await (const event of run) types.push(event.type)
    })().catch((error: Error) => error)
    const result = await run.result
    expect(thrown).toMatchObject({ message: 'Unknown model openai/no-such-model' })
    expect(result).toMatchObject({
      terminal: 'failed',
      error: { message: 'Unknown model openai/no-such-model' },
    })
    expect(types[0]).toBe('agent_start')
    expect(types[types.length - 1]).toBe('agent_end')
  })

  test('composes every port: catalog, completions, sign-in, and the script sandbox', async () => {
    const engine = createEngine()
    expect(engine.id).toBe('localix')
    const catalog = await engine.listCatalog()
    expect(catalog.models.some((model) => model.id === 'openai/gpt-6-luna')).toBe(true)
    expect(catalog.oauthProviderIds).toEqual(
      expect.arrayContaining(['openai', 'openrouter', 'github-copilot']),
    )
    expect(
      engine.scripts?.declare([
        { name: 'read', description: 'Read', inputSchema: { type: 'object' } },
      ]),
    ).toContain('read(args:')
    expect(
      engine
        .createAuth({} as never)
        .listProviders()
        .map((provider) => provider.id),
    ).toContain('openai-codex')
  })
})
