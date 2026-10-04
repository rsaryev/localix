import { describe, expect, test } from 'bun:test'

import type { Model as PiModel } from '@earendil-works/pi-ai'
import type { Message } from '@localixai/agent'

import { assertRequestServable, PreflightRejection, resolveReasoningEffort } from './preflight'

const model = (over: Partial<PiModel<'openai-completions'>> = {}) =>
  ({
    id: 'm',
    name: 'M',
    api: 'openai-completions',
    provider: 'p',
    baseUrl: 'https://example.invalid',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0 },
    contextWindow: 1_000,
    maxTokens: 100,
    ...over,
  }) as PiModel<'openai-completions'>

const textMessage: Message = { role: 'user', content: 'hi', timestamp: 0 } as Message
const imageMessage: Message = {
  role: 'user',
  content: [{ type: 'image', data: 'AAA', mediaType: 'image/png' }],
  timestamp: 0,
} as unknown as Message

describe('reasoning effort', () => {
  test('a model that does no reasoning gets no reasoning, not a dead run', () => {
    expect(resolveReasoningEffort(model({ reasoning: false }), 'high')).toEqual({
      effort: undefined,
      clampedFrom: 'high',
    })
  })

  test('a level the model maps to null is clamped to the nearest one it offers', () => {
    // The failure this replaces: a session carried "minimal" from another model and every
    // turn died with `does not support reasoning effort "minimal"`. Thinking a little more
    // than asked is the same request; refusing it is not.
    expect(
      resolveReasoningEffort(model({ thinkingLevelMap: { minimal: null } }), 'minimal'),
    ).toEqual({ effort: 'low', clampedFrom: 'minimal' })
  })

  test('a level ABSENT from the map passes through — pi falls back to provider defaults', () => {
    // Treating absence as unsupported would change requests that work; only an explicit
    // null means "not here".
    expect(resolveReasoningEffort(model({ thinkingLevelMap: { low: 'low' } }), 'high')).toEqual({
      effort: 'high',
    })
  })

  test('a mapped level passes untouched', () => {
    expect(resolveReasoningEffort(model({ thinkingLevelMap: { high: 'high' } }), 'high')).toEqual({
      effort: 'high',
    })
  })

  test('"off" and absent ask for no reasoning at all', () => {
    expect(resolveReasoningEffort(model(), 'off')).toEqual({ effort: undefined })
    expect(resolveReasoningEffort(model(), undefined)).toEqual({ effort: undefined })
  })

  test('the top levels exist only where the model declares them', () => {
    // pi treats `xhigh`/`max` as opt-in: absent means unavailable, not defaulted.
    expect(resolveReasoningEffort(model(), 'max')).toEqual({ effort: 'high', clampedFrom: 'max' })
    expect(resolveReasoningEffort(model({ thinkingLevelMap: { max: 'max' } }), 'max')).toEqual({
      effort: 'max',
    })
  })
})

describe('input modalities', () => {
  test('an image bound for a text-only model is refused before the network call', () => {
    try {
      assertRequestServable({ model: model({ input: ['text'] }), messages: [imageMessage] })
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as PreflightRejection).code).toBe('unsupported_content')
      expect((error as Error).message).toContain('text input only')
    }
  })

  test('an image passes to a model that declares image input', () => {
    expect(() => assertRequestServable({ model: model(), messages: [imageMessage] })).not.toThrow()
  })

  test('text-only traffic passes to a text-only model', () => {
    expect(() =>
      assertRequestServable({ model: model({ input: ['text'] }), messages: [textMessage] }),
    ).not.toThrow()
  })

  test('a string content body is not mistaken for parts', () => {
    // `content` as a bare string carries no parts to inspect; scanning it as an array
    // would be a type error at best and a false positive at worst.
    expect(() =>
      assertRequestServable({ model: model({ input: ['text'] }), messages: [textMessage] }),
    ).not.toThrow()
  })

  test('an image anywhere in the history counts, not just the last message', () => {
    expect(() =>
      assertRequestServable({
        model: model({ input: ['text'] }),
        messages: [imageMessage, textMessage],
      }),
    ).toThrow(PreflightRejection)
  })
})
