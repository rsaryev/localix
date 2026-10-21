import { describe, expect, test } from 'bun:test'

import type { ModelSession } from '@localixai/agent/runtime'

import { createEngine, lazySession } from './engine'

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

  test('a stop ends a turn waiting for its session at once, even when the opening ignores it', async () => {
    const never = new Promise<ModelSession>(() => {})
    const session = lazySession(
      { model: { providerId: 'openai', modelId: 'gpt' } } as never,
      () => never,
    )
    const controller = new AbortController()
    const turn = session.turn({ signal: controller.signal } as never)
    setTimeout(() => controller.abort(), 10)
    const started = Date.now()
    const message = await turn.message
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(message).toMatchObject({ stopReason: 'aborted', errorMessage: expect.any(String) })
  })

  test('a session that cannot open fails its turn with the reason, on the turn and as the failure', async () => {
    const session = lazySession(
      { model: { providerId: 'openai', modelId: 'gpt' } } as never,
      async () => {
        throw new Error('OAuth refresh failed')
      },
    )
    const turn = session.turn({ signal: new AbortController().signal } as never)
    expect(await turn.message).toMatchObject({
      stopReason: 'error',
      errorMessage: 'OAuth refresh failed',
    })
    expect(turn.failure?.message).toBe('OAuth refresh failed')
  })
})
