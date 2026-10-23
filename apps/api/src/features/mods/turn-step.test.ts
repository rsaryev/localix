import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '@localixai/agent'
import type { Hook } from '@localixai/claude-plugin/mods'
import { hostWithMod } from './testing/testing-host'

/** `turn.step` hooks written as Claude Code documents them: async generators over the stream. */

const answer = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  model: 'model-a',
  stopReason: 'end_turn',
  usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 7 },
  timestamp: 0,
})

describe('turn.step as an async generator', () => {
  test('`yield* next(e)` sends the request and the response goes on unchanged', async () => {
    const logged: string[] = []
    const { scope } = await hostWithMod((on) => {
      on('turn.step', async function* ($, e, next) {
        const result = (yield* next(e) as AsyncGenerator<unknown, unknown>) as {
          usage: { cache_read_input_tokens: number } | null
        }
        if (result.usage) logged.push(`cache read ${result.usage.cache_read_input_tokens}`)
        return result
      } as Hook)
    })
    let sent = 0
    const message = await scope.modelStep('turn-1')!(
      { index: 0, modelId: 'model-a', messageCount: 2 },
      async () => (++sent, answer('hi')),
    )
    expect(message.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(sent).toBe(1)
    expect(logged).toEqual(['cache read 7'])
  })

  test('a generator that yields its own response sends no request', async () => {
    const { scope } = await hostWithMod((on) => {
      on('turn.step', async function* () {
        yield { kind: 'text', index: 0, text: 'Offline.' }
      } as Hook)
    })
    const message = await scope.modelStep('turn-1')!(
      { index: 0, modelId: 'model-a', messageCount: 1 },
      async () => {
        throw new Error('sent')
      },
    )
    expect(message.content).toEqual([{ type: 'text', text: 'Offline.' }])
    expect(message.stopReason).toBe('end_turn')
  })
})
