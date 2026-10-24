import { describe, expect, test } from 'bun:test'
import type { ModelCompletion, ModelCompletionRequest } from '../contracts'
import { createModelApi } from './model-api'

const ZERO = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
const USED = { ...ZERO, input_tokens: 12, output_tokens: 3 }

function modelApi(
  reply: (request: ModelCompletionRequest) => ModelCompletion,
  messages = [{ role: 'user' as const, text: 'hi', toolUses: [] }],
) {
  const asked: ModelCompletionRequest[] = []
  const api = createModelApi({
    complete: async (request) => (asked.push(request), reply(request)),
    messages: async () => messages,
  })
  return { api, asked }
}

describe('$.model', () => {
  test('complete resolves Claude Code’s result: the reply with its usage', async () => {
    const { api, asked } = modelApi((request) => ({
      isAnswered: true,
      text: `re: ${request.prompt}`,
      usage: USED,
    }))
    expect(await api.complete({ model: 'haiku', prompt: 'Hi.' })).toEqual({
      isAnswered: true,
      text: 're: Hi.',
      usage: USED,
    })
    // Blocks of text are sent joined, as the hooks read them; effort and the time limit ride along.
    await api.complete({
      model: 'haiku',
      prompt: [{ text: 'RULES ', cache: true }, { text: 'diff' }],
      system: [{ text: 'Be brief.' }],
      effort: 'low',
      timeoutMs: 8000,
    })
    expect(asked[1]).toMatchObject({
      prompt: 'RULES diff',
      system: 'Be brief.',
      effort: 'low',
      timeoutMs: 8000,
    })
    expect(asked[1]!.signal).toBeInstanceOf(AbortSignal)
  })

  test('what the model did never rejects: an API error, an empty reply, a cut call', async () => {
    const failing = modelApi(() => ({
      isAnswered: false,
      reason: 'api-error',
      status: 529,
      error: 'overloaded',
      usage: ZERO,
    }))
    expect(await failing.api.complete({ model: 'haiku', prompt: 'x' })).toEqual({
      isAnswered: false,
      reason: 'api-error',
      status: 529,
      error: 'overloaded',
      usage: ZERO,
    })
    const empty = modelApi(() => ({ isAnswered: true, text: '', usage: USED }))
    expect(await empty.api.complete({ model: 'haiku', prompt: 'x' })).toEqual({
      isAnswered: false,
      reason: 'empty-reply',
      usage: USED,
    })
    const stopped = modelApi(() => ({ isAnswered: true, text: 'late', usage: USED }))
    const stop = new AbortController()
    stop.abort()
    expect(
      await stopped.api.complete({ model: 'haiku', prompt: 'x' }, { signal: stop.signal }),
    ).toEqual({ isAnswered: false, reason: 'aborted', usage: ZERO })
    expect(stopped.asked).toEqual([])
  })

  test('a request Claude Code refuses throws, naming what is wrong', async () => {
    const { api } = modelApi(() => ({ isAnswered: true, text: 'x', usage: USED }))
    const refused = (request: unknown) =>
      api.complete(request).then(
        () => 'answered',
        (error: Error) => error.message,
      )
    expect(await refused({ model: 'haiku' })).toContain('prompt')
    expect(await refused({ model: 'haiku', prompt: 'x', effort: 'huge' })).toContain('effort')
    expect(await refused({ model: 'haiku', prompt: 'x', maxTokens: 64_001 })).toContain('64000')
    expect(await refused({ model: 'haiku', prompt: 'x', timeoutMs: -1 })).toContain('timeoutMs')
  })

  test('fork asks after the conversation so far, and says why it was not answered', async () => {
    const { api, asked } = modelApi((request) => ({
      isAnswered: true,
      text: `re: ${request.prompt}`,
      usage: USED,
    }))
    expect(await api.fork({ prompt: 'Summarize' })).toEqual({
      isAnswered: true,
      text: 're: Summarize',
      usage: USED,
    })
    expect(asked[0]!.history).toEqual([{ role: 'user', text: 'hi' }])
    const fresh = modelApi(() => ({ isAnswered: true, text: 'x', usage: USED }), [])
    expect(await fresh.api.fork({ prompt: 'x' })).toEqual({
      isAnswered: false,
      reason: 'nothing-to-fork',
    })
  })

  test('classify names one of the labels', async () => {
    const { api } = modelApi(() => ({ isAnswered: true, text: ' "billing".', usage: USED }))
    expect(await api.classify('My card was charged twice', ['billing', 'bug'])).toBe('billing')
  })
})
