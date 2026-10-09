import { expect, test } from 'bun:test'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import { createContextTransform } from './runtime-context'

test('context transforms retain original system messages and read the current host policy', async () => {
  const signal = new AbortController().signal
  const prompt = { role: 'system' as const, content: 'prompt', timestamp: 1 }
  const tools = { role: 'system' as const, content: 'tool roster', timestamp: 2 }
  const user = { role: 'user' as const, content: 'source', timestamp: 3 }
  const seen: unknown[] = []
  const input: Pick<AgentRuntimeRunInput, 'contextPolicy'> = {
    contextPolicy: {
      transform: async () => {
        throw new Error('outdated policy')
      },
    },
  }
  const transform = createContextTransform(input, signal)!
  input.contextPolicy = {
    transform: async (messages, receivedSignal) => {
      seen.push(messages, receivedSignal)
      return []
    },
  }
  const result = await transform([prompt, user, tools])
  expect(result).toEqual([prompt, tools])
  expect(result[0]).toBe(prompt)
  expect(result[1]).toBe(tools)
  expect((seen[0] as { role: string }[]).map((message) => message.role)).toEqual(['user'])
  expect(seen[1]).toBe(signal)
})

test('an absent policy stays absent and a policy failure retains its original error', async () => {
  const signal = new AbortController().signal
  expect(createContextTransform({}, signal)).toBeUndefined()
  const failure = new Error('policy failed')
  const transform = createContextTransform(
    {
      contextPolicy: {
        transform: async () => {
          throw failure
        },
      },
    },
    signal,
  )!
  await expect(transform([])).rejects.toThrow(failure)
})
