import { describe, expect, test } from 'bun:test'
import type { AgentMessageDelta } from '../agents'
import type { AssistantMessage } from '../types'
import type { ModelSession, ModelTurnRequest } from './model-session'
import { withModelSteps } from './model-steps'

const reply = (model: string, text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  model,
  stopReason: 'end_turn',
  timestamp: 0,
})

/** A session that answers every request with its model's name and the effort asked for. */
function session(modelId: string, seen: string[]): ModelSession {
  return {
    ref: { providerId: 'p', modelId },
    turn(request) {
      const text = `${modelId}/${request.reasoningEffort ?? 'default'}`
      seen.push(text)
      const delta: AgentMessageDelta = {
        kind: 'text',
        phase: 'delta',
        contentIndex: 0,
        delta: text,
        origin: { model: modelId },
      }
      return {
        message: Promise.resolve(reply(modelId, text)),
        failure: undefined,
        async *[Symbol.asyncIterator]() {
          yield delta
        },
      }
    },
  }
}

const request = (count: number): ModelTurnRequest => ({
  systemPrompt: '',
  messages: Array.from({ length: count }, () => ({ role: 'user', content: 'hi', timestamp: 0 })),
  tools: [],
  reasoningEffort: 'high',
  signal: new AbortController().signal,
})

async function read(turn: ReturnType<ModelSession['turn']>) {
  const deltas: string[] = []
  for await (const delta of turn) deltas.push(delta.delta)
  return { deltas, message: await turn.message }
}

describe('model steps', () => {
  test('a hook sees each step and may send it on another model or effort', async () => {
    const seen: string[] = []
    const steps: unknown[] = []
    const stepped = withModelSteps(
      session('main', seen),
      (step, send) => {
        steps.push(step)
        return step.index === 0 ? send() : send({ modelId: 'small', reasoningEffort: 'low' })
      },
      (modelId) => session(modelId, seen),
    )
    expect((await read(stepped.turn(request(1)))).deltas).toEqual(['main/high'])
    const second = await read(stepped.turn(request(3)))
    expect(second.message.model).toBe('small')
    expect(seen).toEqual(['main/high', 'small/low'])
    expect(steps).toEqual([
      { index: 0, modelId: 'main', reasoningEffort: 'high', messageCount: 1 },
      { index: 1, modelId: 'main', reasoningEffort: 'high', messageCount: 3 },
    ])
  })

  test('an answer without a request is the response the loop reads and streams', async () => {
    const seen: string[] = []
    const stepped = withModelSteps(
      session('main', seen),
      async () => reply('main', 'answered by the host'),
      (modelId) => session(modelId, seen),
    )
    const { deltas, message } = await read(stepped.turn(request(1)))
    expect(seen).toEqual([])
    expect(deltas).toEqual(['', 'answered by the host', ''])
    expect(message.content).toEqual([{ type: 'text', text: 'answered by the host' }])
  })

  test('a hook that throws ends the step as a failed response', async () => {
    const stepped = withModelSteps(
      session('main', []),
      async () => {
        throw new Error('no')
      },
      (modelId) => session(modelId, []),
    )
    expect((await read(stepped.turn(request(1)))).message).toMatchObject({
      stopReason: 'error',
      errorMessage: 'no',
    })
  })
})
