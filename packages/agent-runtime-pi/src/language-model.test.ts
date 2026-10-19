import { describe, expect, test } from 'bun:test'
import type {
  AssistantMessage as PiAssistantMessage,
  Model as PiModel,
} from '@earendil-works/pi-ai'
import {
  PiLanguageModelCompletionError,
  createPiLanguageModelFactory,
  fromPiCompletion,
  normalizeCompletionMaxTokens,
  normalizeCompletionReasoning,
  normalizeCompletionTemperature,
} from './language-model'

const reasoningModel = (over: Partial<PiModel<'openai-completions'>> = {}) =>
  ({
    id: 'm',
    name: 'M',
    api: 'openai-completions',
    provider: 'p',
    baseUrl: 'https://example.invalid',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: 1_000,
    maxTokens: 100,
    ...over,
  }) as PiModel<'openai-completions'>

describe('normalizeCompletionReasoning', () => {
  test('disables reasoning where off is supported', () => {
    expect(normalizeCompletionReasoning(reasoningModel(), 'off')).toBeUndefined()
    expect(
      normalizeCompletionReasoning(reasoningModel({ reasoning: false }), 'off'),
    ).toBeUndefined()
  })

  test('selects the lowest supported effort when reasoning is mandatory', () => {
    expect(
      normalizeCompletionReasoning(
        reasoningModel({ thinkingLevelMap: { off: null, minimal: 'minimal' } }),
        'off',
      ),
    ).toBe('minimal')
    expect(
      normalizeCompletionReasoning(
        reasoningModel({ thinkingLevelMap: { off: null, minimal: null, low: 'low' } }),
        'off',
      ),
    ).toBe('low')
    expect(
      normalizeCompletionReasoning(
        reasoningModel({
          thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high' },
        }),
        'off',
      ),
    ).toBe('high')
  })

  test('preserves explicit supported efforts for other auxiliary workloads', () => {
    expect(normalizeCompletionReasoning(reasoningModel(), 'high')).toBe('high')
    expect(normalizeCompletionReasoning(reasoningModel(), undefined)).toBeUndefined()
  })
})

function piCompletion(
  stopReason: PiAssistantMessage['stopReason'],
  errorMessage?: string,
): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: stopReason === 'stop' ? 'done' : 'partial' }],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    usage: {
      input: 7,
      output: 3,
      cacheRead: 11,
      cacheWrite: 5,
      totalTokens: 26,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 1,
  }
}

describe('normalizeCompletionMaxTokens', () => {
  const shared = { api: 'openai-responses', maxTokens: 128_000 }

  test('leaves the ceiling alone when nothing reasons', () => {
    expect(normalizeCompletionMaxTokens(shared, 64, undefined)).toBe(64)
    expect(normalizeCompletionMaxTokens(shared, undefined, 'low')).toBeUndefined()
  })

  test('adds the level budget where reasoning shares the output ceiling', () => {
    // A 64-token answer ceiling spent by mandatory `low` reasoning returned max_tokens.
    expect(normalizeCompletionMaxTokens(shared, 64, 'minimal')).toBe(64 + 1024)
    expect(normalizeCompletionMaxTokens(shared, 64, 'low')).toBe(64 + 2048)
    expect(
      normalizeCompletionMaxTokens({ ...shared, api: 'google-generative-ai' }, 64, 'high'),
    ).toBe(64 + 16_384)
  })

  test('does not add room twice where the adapter already reserves it', () => {
    expect(normalizeCompletionMaxTokens({ ...shared, api: 'anthropic-messages' }, 64, 'low')).toBe(
      64,
    )
    expect(
      normalizeCompletionMaxTokens({ ...shared, api: 'bedrock-converse-stream' }, 64, 'low'),
    ).toBe(64)
  })

  test('stays within the model ceiling but never below the caller request', () => {
    expect(normalizeCompletionMaxTokens({ ...shared, maxTokens: 1_500 }, 64, 'low')).toBe(1_500)
    expect(normalizeCompletionMaxTokens({ ...shared, maxTokens: 32 }, 64, 'low')).toBe(64)
    expect(normalizeCompletionMaxTokens({ ...shared, maxTokens: 0 }, 64, 'low')).toBe(64 + 2048)
  })
})

describe('normalizeCompletionTemperature', () => {
  test('omits temperature for the Codex Responses transport', () => {
    expect(normalizeCompletionTemperature({ api: 'openai-codex-responses' }, 0.2)).toBeUndefined()
  })

  test('preserves temperature for providers that support sampling', () => {
    expect(normalizeCompletionTemperature({ api: 'openai-completions' }, 0.2)).toBe(0.2)
  })
})

describe('Pi buffered completion contract', () => {
  test('resolves only a usable completion', () => {
    expect(fromPiCompletion(piCompletion('stop'))).toMatchObject({
      stopReason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
      usage: {
        inputTokens: 23,
        outputTokens: 3,
        cacheReadTokens: 11,
        cacheWriteTokens: 5,
        totalTokens: 26,
      },
    })
  })

  test('rejects Pi stopReason=error and retains its converted message and billed usage', () => {
    let thrown: unknown
    try {
      fromPiCompletion(piCompletion('error', 'maximum context length exceeded'))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PiLanguageModelCompletionError)
    expect(thrown).toMatchObject({
      name: 'PiLanguageModelCompletionError',
      message: 'maximum context length exceeded',
      stopReason: 'error',
      usage: {
        inputTokens: 23,
        outputTokens: 3,
        cacheReadTokens: 11,
        cacheWriteTokens: 5,
      },
      assistantMessage: {
        stopReason: 'error',
        errorMessage: 'maximum context length exceeded',
      },
    })
  })

  test('rejects Pi stopReason=aborted with the engine-neutral AbortError shape', () => {
    let thrown: unknown
    try {
      fromPiCompletion(piCompletion('aborted', 'Request was aborted'))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PiLanguageModelCompletionError)
    expect(thrown).toMatchObject({
      name: 'AbortError',
      message: 'Request was aborted',
      stopReason: 'aborted',
    })
  })
})

describe('decision models', () => {
  const jev = createPiLanguageModelFactory().create(
    { providerId: 'openrouter', modelId: '~typesafe/jev-latest' },
    { type: 'api-key', key: 'sk-test' },
  )
  const request = {
    state: { transcript: [{ author: 'person', text: 'Make the button wrap' }] },
    questions: {
      next: {
        type: 'choice' as const,
        instructions: 'Who should take the floor?',
        criteria: { frontend: 'The interface', backend: 'Server code' },
      },
    },
  }

  async function withFetch<T>(
    respond: (url: string, body: unknown) => Response,
    run: () => Promise<T>,
  ) {
    const original = globalThis.fetch
    const seen: { url: string; body: unknown }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const body = JSON.parse(init?.body as string)
      seen.push({ url, body })
      return respond(url, body)
    }) as typeof fetch
    try {
      return { result: await run(), seen }
    } finally {
      globalThis.fetch = original
    }
  }

  test("decides through pi's System One call and returns the choice with its probabilities", async () => {
    const { result, seen } = await withFetch(
      () =>
        Response.json({
          answers: {
            next: {
              type: 'choice',
              choice: 'frontend',
              probabilities: { frontend: 0.97, backend: 0.03 },
              confidence: 0.9,
            },
          },
          usage: { input_tokens: 341, output_tokens: 31 },
        }),
      () => jev.decide!(request),
    )
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/systemone')
    expect(seen[0]!.body).toMatchObject({ model: '~typesafe/jev-latest', state: request.state })
    expect(result.answers).toEqual({
      next: {
        type: 'choice',
        choice: 'frontend',
        probabilities: { frontend: 0.97, backend: 0.03 },
      },
    })
    expect(result.usage?.inputTokens).toBe(341)
  })

  test('a yes/no question goes out as System One’s noul and comes back as a probability', async () => {
    const { result, seen } = await withFetch(
      () =>
        Response.json({
          answers: { specialist: { type: 'noul', noul: 0.81 } },
          usage: { input_tokens: 120, output_tokens: 8 },
        }),
      () =>
        jev.decide!({
          state: request.state,
          questions: {
            specialist: {
              type: 'bool',
              instructions: 'Is it a specialist’s job?',
              criteria: { true: 'A specialist’s field', false: 'The leader’s' },
            },
          },
        }),
    )
    expect(
      (seen[0]!.body as { questions: { specialist: { type: string } } }).questions.specialist.type,
    ).toBe('noul')
    expect(result.answers).toEqual({ specialist: { type: 'bool', probability: 0.81 } })
  })

  test('rejects a failed decision instead of answering nothing', async () => {
    const { result } = await withFetch(
      () => new Response('{"error":{"message":"overloaded"}}', { status: 503 }),
      () =>
        jev.decide!(request).then(
          () => 'resolved',
          () => 'rejected',
        ),
    )
    expect(result).toBe('rejected')
  })

  test('a chat model is not a decision model', async () => {
    const chat = createPiLanguageModelFactory().create(
      { providerId: 'openrouter', modelId: 'typesafe/jev-router' },
      { type: 'api-key', key: 'sk-test' },
    )
    await expect(chat.decide!(request)).rejects.toThrow('Unknown pi decision model')
  })
})
