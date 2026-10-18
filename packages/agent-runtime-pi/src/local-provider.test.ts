import { describe, expect, test } from 'bun:test'
import { MODEL_NOT_DOWNLOADED } from '@localixai/agent/agents'
import { createLocalProvider, type LocalChatModel, type LocalProviderHost } from './local-provider'

const tiny: LocalChatModel = {
  id: 'ggml-org/tiny-GGUF:Q4_0',
  name: 'tiny (Q4_0)',
  contextWindow: 4096,
  maxTokens: 2048,
  vision: false,
  reasoning: false,
}

/** A host listing `models`; those in `missing` are not on this computer. */
function host(
  models: LocalChatModel[],
  missing: readonly string[] = [],
): LocalProviderHost & { endpoints: number } {
  const here = (id: string) => models.some((m) => m.id === id) && !missing.includes(id)
  const h = {
    endpoints: 0,
    models: () => models,
    isInstalled: here,
    whenReady: async (id: string) => {
      if (!here(id)) throw new Error('not downloaded')
    },
    endpoint: async () => {
      h.endpoints += 1
      return { baseUrl: 'http://127.0.0.1:4321', apiKey: 'per-start-key' }
    },
  }
  return h
}

describe('local provider', () => {
  test('a thinking model offers reasoning levels and sends them through its chat template', () => {
    const provider = createLocalProvider(host([{ ...tiny, reasoning: true }]))
    const [model] = provider.getModels()
    expect(model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { minimal: null },
      compat: {
        thinkingFormat: 'chat-template',
        chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } },
        thinkingTokenBudgetField: 'thinking_budget_tokens',
      },
    })
    const [plain] = createLocalProvider(host([tiny])).getModels()
    expect(plain).toMatchObject({ reasoning: false })
    expect(plain!.compat).not.toHaveProperty('thinkingFormat')
  })

  test('lists the host models on every read, free of charge, as OpenAI-compatible chat', () => {
    const models = [tiny]
    const provider = createLocalProvider(host(models))
    expect(provider.getModels().map((m) => m.id)).toEqual([tiny.id])
    models.push({ ...tiny, id: 'ggml-org/vision-GGUF:Q4_0', vision: true })
    const listed = provider.getModels()
    expect(listed).toHaveLength(2)
    expect(listed[1]).toMatchObject({
      api: 'openai-completions',
      input: ['text', 'image'],
      cost: { input: 0, output: 0 },
    })
  })

  test('auth resolves the running server per request, with its per-start key', async () => {
    const h = host([tiny])
    const provider = createLocalProvider(h)
    const resolved = await provider.auth.apiKey!.resolve({
      ctx: { env: async () => undefined, fileExists: async () => false },
      signal: new AbortController().signal,
    })
    expect(resolved?.auth).toEqual({ apiKey: 'per-start-key', baseUrl: 'http://127.0.0.1:4321/v1' })
    expect(h.endpoints).toBe(1)
  })

  test('a model that is not coming ends its stream with the host’s reason, without a server', async () => {
    const pending = { ...tiny, id: 'ggml-org/later-GGUF:Q4_0' }
    const h = host([pending], [pending.id])
    const provider = createLocalProvider(h)
    const [model] = provider.getModels()
    const stream = provider.stream(model!, { messages: [] } as never, undefined)
    const result = await stream.result()
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain(`${MODEL_NOT_DOWNLOADED} not downloaded`)
    expect(h.endpoints).toBe(0)
  })

  test('a model still downloading is waited for, then answers', async () => {
    let ready!: () => void
    const waiting = new Promise<void>((resolve) => (ready = resolve))
    const h = host([tiny], [tiny.id])
    h.whenReady = () => waiting
    const provider = createLocalProvider(h)
    const [model] = provider.getModels()
    const stream = provider.stream(model!, { messages: [] } as never, undefined)
    let settled = false
    void stream.result().then(() => (settled = true))
    await Bun.sleep(5)
    // Still downloading: the stream waits instead of failing.
    expect(settled).toBe(false)
    ready()
    const result = await stream.result()
    // Past the wait it is the server's stream (unreachable here), not the not-downloaded error.
    expect(result.errorMessage ?? '').not.toContain(MODEL_NOT_DOWNLOADED)
  })
})
