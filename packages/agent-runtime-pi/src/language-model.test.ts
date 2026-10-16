import { describe, expect, test } from 'bun:test'
import type {
  AssistantMessage as PiAssistantMessage,
  Model as PiModel,
} from '@earendil-works/pi-ai'
import {
  PiLanguageModelCompletionError,
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
