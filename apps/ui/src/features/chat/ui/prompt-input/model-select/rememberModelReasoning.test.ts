import { expect, test } from 'bun:test'
import { rememberModelReasoning } from './rememberModelReasoning'

test('a chosen level moves that model to the front and preserves workload metadata', () => {
  const base = {
    modelRouting: {
      session: {
        reasoningPreferences: [
          { providerId: 'openai', modelId: 'first', effort: 'high' },
          { providerId: 'openai', modelId: 'second', effort: 'low' },
        ],
      },
      titleGeneration: { enabled: false },
    },
  }
  let written: Record<string, unknown> | undefined
  rememberModelReasoning(
    {
      read: () => base,
      write: (next) => {
        written = next
      },
    },
    'session',
    { providerId: 'openai', modelId: 'second', effort: 'max' },
  )
  expect(written).toEqual({
    modelRouting: {
      session: {
        reasoningPreferences: [
          { providerId: 'openai', modelId: 'second', effort: 'max' },
          { providerId: 'openai', modelId: 'first', effort: 'high' },
        ],
      },
      titleGeneration: { enabled: false },
    },
  })
})
