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

test('a model that cannot answer rejects complete, and a fork with no conversation is null', async () => {
  const api = createModelApi({
    complete: async () => ({ isAnswered: false, reason: 'no model' }),
    messages: async () => [],
  })
  await expect(api.complete({ prompt: 'x' })).rejects.toThrow('model.complete: no model')
  expect(await api.fork({ prompt: 'x' })).toBeNull()
})
