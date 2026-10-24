import { expect, test } from 'bun:test'
import type { ModelCompletionRequest } from '../contracts'
import { createModelApi } from './model-api'

test('model calls answer in Claude Code’s shapes', async () => {
  const asked: ModelCompletionRequest[] = []
  const api = createModelApi({
    complete: async (request) => {
      asked.push(request)
      return { isAnswered: true, text: request.system ? ' "billing".' : `re: ${request.prompt}` }
    },
    messages: async () => [{ role: 'user', text: 'hi', toolUses: [] }],
  })
  expect(await api.complete({ model: 'haiku', prompt: 'Hi.' })).toBe('re: Hi.')
  expect(await api.fork({ prompt: 'Summarize' })).toEqual({
    isAnswered: true,
    text: 're: Summarize',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  })
  expect(asked[1]!.history).toEqual([{ role: 'user', text: 'hi' }])
  expect(await api.classify('My card was charged twice', ['billing', 'bug'])).toBe('billing')
})

test('a model that cannot answer rejects complete; a fork says why it was not answered', async () => {
  const api = createModelApi({
    complete: async () => ({ isAnswered: false, reason: 'no model' }),
    messages: async () => [],
  })
  await expect(api.complete({ prompt: 'x' })).rejects.toThrow('model.complete: no model')
  // Claude Code 2.1.310: a fork is never null; a mod reads `isAnswered` (next-steps does).
  expect(await api.fork({ prompt: 'x' })).toEqual({ isAnswered: false, reason: 'nothing-to-fork' })

  const unanswered = createModelApi({
    complete: async () => ({ isAnswered: false, reason: 'no model' }),
    messages: async () => [{ role: 'user' as const, text: 'hi', toolUses: [] }],
  })
  expect(await unanswered.fork({ prompt: 'x' })).toMatchObject({
    isAnswered: false,
    reason: 'api-error',
    error: 'no model',
  })
})
