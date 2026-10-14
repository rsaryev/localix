import { describe, expect, test } from 'bun:test'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  SystemMessage,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai'

import { wrapPiModel, type PiModelMiddleware } from './middleware'

/**
 * A request's instructions live IN the transcript now (pi moved the system prompt and the
 * tool roster into the message list), so a middleware that wants to change them edits a
 * system message — which is what these cases exercise.
 */
const transcript = (systemPrompt?: string): TranscriptContext =>
  normalizeContext({ messages: [], ...(systemPrompt ? { systemPrompt } : {}) })

const systemText = (context: TranscriptContext): string =>
  context.messages
    .filter((message): message is SystemMessage => message.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : ''))
    .join('')

/** Nothing here consumes the stream — identity is all the assertions need. */
const stream = { kind: 'base-stream' } as unknown as AssistantMessageEventStream
const model = { id: 'faux-1', provider: 'faux' } as unknown as Model<Api>
const otherModel = { id: 'faux-2', provider: 'faux' } as unknown as Model<Api>

function baseSpy() {
  const calls: Array<{
    model: Model<Api>
    context: TranscriptContext
    options?: SimpleStreamOptions
  }> = []
  const fn: StreamFn = (requestModel, context, options) => {
    calls.push({ model: requestModel, context, ...(options ? { options } : {}) })
    return stream
  }
  return { calls, fn }
}

describe('pi model middleware', () => {
  test('an empty chain is the unwrapped function itself: same args, same result', async () => {
    const { calls, fn } = baseSpy()
    const wrapped = wrapPiModel(fn, [])
    expect(wrapped).toBe(fn)
    // Hook-less middlewares contribute no layer either — still the same reference.
    expect(wrapPiModel(fn, [{}, {}])).toBe(fn)

    const context = transcript()
    const options: SimpleStreamOptions = { maxTokens: 7, sessionId: 'run-1' }
    const result = await wrapped(model, context, options)
    expect(result).toBe(stream)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.model).toBe(model)
    expect(calls[0]?.context).toBe(context)
    expect(calls[0]?.options).toBe(options)
  })

  test('the FIRST middleware in the array is outermost (AI SDK order)', async () => {
    const { calls, fn } = baseSpy()
    const order: string[] = []
    const tag = (label: string): PiModelMiddleware => ({
      transformParams: (params) => {
        order.push(`${label}:transform`)
        return {
          ...params,
          context: transcript(`${systemText(params.context)}${label}`),
        }
      },
      wrapStreamSimple: async ({ params, doStreamSimple }) => {
        order.push(`${label}:enter`)
        const result = await doStreamSimple(params)
        order.push(`${label}:exit`)
        return result
      },
    })

    await wrapPiModel(fn, [tag('A'), tag('B')])(model, transcript())

    // A outermost: its transform runs first, its wrap encloses B's — so the base
    // function sees A's tag applied before B's.
    expect(order).toEqual(['A:transform', 'A:enter', 'B:transform', 'B:enter', 'B:exit', 'A:exit'])
    expect(systemText(calls[0]!.context)).toBe('AB')
  })

  test('transformParams reshapes every part of the request the base call sees', async () => {
    const { calls, fn } = baseSpy()
    const middleware: PiModelMiddleware = {
      transformParams: (params) => ({
        ...params,
        model: otherModel,
        options: { ...params.options, maxTokens: 42 },
      }),
    }

    await wrapPiModel(fn, [middleware])(model, transcript(), { maxTokens: 7 })

    expect(calls[0]?.model).toBe(otherModel)
    expect(calls[0]?.options?.maxTokens).toBe(42)
  })

  test('wrapStreamSimple can short-circuit without touching the provider', async () => {
    const { calls, fn } = baseSpy()
    const substitute = { kind: 'substitute' } as unknown as AssistantMessageEventStream

    const result = await wrapPiModel(fn, [{ wrapStreamSimple: () => substitute }])(
      model,
      transcript(),
    )

    expect(result).toBe(substitute)
    expect(calls).toHaveLength(0)
  })
})
