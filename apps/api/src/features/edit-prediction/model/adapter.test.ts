import { describe, expect, it } from 'bun:test'
import type { AssistantMessage, StopReason } from '@localixai/agent'
import type { LanguageModel } from '@localixai/agent/runtime'
import { createLanguageModelAdapter, messageText, normalizeFinishReason } from './adapter'
import type { NormalizedModelRequest } from './contracts'

const REQUEST: NormalizedModelRequest = {
  modelId: 'm',
  systemPrompt: 'sys',
  userContent: 'user',
  budget: { outputTokens: 1024 },
  temperature: 0.01,
  reasoningEffort: 'off',
  promptCaching: 'long',
}

function fakeModel(
  message: Partial<AssistantMessage>,
  capture?: (opts: Record<string, unknown>) => void,
): LanguageModel {
  return {
    ref: { providerId: 'fake', modelId: 'm' },
    complete: async (request) => {
      capture?.(request as unknown as Record<string, unknown>)
      return {
        role: 'assistant',
        content: [],
        model: 'm',
        timestamp: 0,
        ...message,
      } as AssistantMessage
    },
  }
}

describe('messageText', () => {
  it('reads a plain string', () => {
    expect(messageText('hi')).toBe('hi')
  })
  it('concatenates text blocks and ignores non-text', () => {
    expect(
      messageText([
        { type: 'text', text: 'a' },
        { type: 'thinking', text: 'x' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab')
  })
  it('returns empty for a non-array non-string', () => {
    expect(messageText(undefined)).toBe('')
  })
})

describe('normalizeFinishReason', () => {
  const cases: Array<[StopReason | undefined, string]> = [
    ['max_tokens', 'length'],
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['tool_use', 'stop'],
    ['aborted', 'aborted'],
    ['error', 'error'],
    [undefined, 'unknown'],
  ]
  for (const [stop, expected] of cases) {
    it(`${String(stop)} → ${expected}`, () => {
      expect(normalizeFinishReason(stop)).toBe(expected as never)
    })
  }
})

describe('createLanguageModelAdapter', () => {
  it('never advertises prompt caching for a per-keystroke request', () => {
    const adapter = createLanguageModelAdapter(fakeModel({}), 'm')
    expect(adapter.capabilities()).toEqual({
      structuredOutput: false,
      streaming: true,
      cancellation: true,
      // The ~323-token static prefix is below every provider cache minimum, and the
      // provider also marks the volatile file window — so retention only ever bought a
      // write premium on a prefix nothing reads back. See the adapter for the numbers.
      promptCaching: 'none',
    })
  })

  it('maps promptCaching:long → cacheRetention:long in the agnostic model request', async () => {
    let opts: Record<string, unknown> = {}
    const adapter = createLanguageModelAdapter(
      fakeModel({ content: [{ type: 'text', text: 'reply' }], stopReason: 'end_turn' }, (o) => {
        opts = o
      }),
      'm',
    )
    const res = await adapter.predict(REQUEST, new AbortController().signal)
    expect(opts).toMatchObject({
      systemPrompt: 'sys',
      messages: [expect.objectContaining({ role: 'user', content: 'user' })],
      temperature: 0.01,
      maxOutputTokens: 1024,
      reasoningEffort: 'off',
      cacheRetention: 'long',
      signal: expect.any(AbortSignal),
    })
    expect(opts).not.toHaveProperty('model')
    expect(res).toMatchObject({ text: 'reply', finishReason: 'stop', truncated: false })
  })

  it('flags a max_tokens reply as truncated (finishReason length)', async () => {
    const adapter = createLanguageModelAdapter(
      fakeModel({ content: [{ type: 'text', text: '{"startLine' }], stopReason: 'max_tokens' }),
      'm',
    )
    const res = await adapter.predict(REQUEST, new AbortController().signal)
    expect(res.finishReason).toBe('length')
    expect(res.truncated).toBe(true)
  })

  it('maps promptCaching:none → cacheRetention:none', async () => {
    let opts: Record<string, unknown> = {}
    const adapter = createLanguageModelAdapter(
      fakeModel({ content: [] }, (o) => {
        opts = o
      }),
      'm',
    )
    await adapter.predict({ ...REQUEST, promptCaching: 'none' }, new AbortController().signal)
    expect(opts.cacheRetention).toBe('none')
  })
})
