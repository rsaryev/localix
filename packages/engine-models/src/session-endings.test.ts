import { describe, expect, test } from 'bun:test'
import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import { classifyAgentError } from '@localixai/agent/agents'
import type { ModelTurnRequest } from '@localixai/agent/runtime'

import { describeFailure, isRetryable } from './retry'
import { createModelSession, type BoundModel } from './session'

type Attempt =
  | Error
  | ((options: LanguageModelV4CallOptions) => ReadableStream<LanguageModelV4StreamPart>)

/** A provider model whose streams record being cancelled and their request being aborted. */
function recordingModel(attempts: Attempt[]) {
  const calls: LanguageModelV4CallOptions[] = []
  const model = {
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'fake-1',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('not used')),
    async doStream(options: LanguageModelV4CallOptions) {
      calls.push(options)
      const attempt = attempts[calls.length - 1]
      if (!attempt) throw new Error('no attempt left')
      if (attempt instanceof Error) throw attempt
      return { stream: attempt(options) }
    },
  } as unknown as LanguageModelV4
  return { model, calls }
}

function parts(list: LanguageModelV4StreamPart[], keepOpen = false, onCancel?: () => void) {
  return () =>
    new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of list) controller.enqueue(part)
        if (!keepOpen) controller.close()
      },
      cancel: onCancel,
    })
}

const text = (delta: string): LanguageModelV4StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta },
]
const finish = (unified: 'stop' | 'content-filter' = 'stop'): LanguageModelV4StreamPart => ({
  type: 'finish',
  usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } as never,
  finishReason: { unified, raw: unified },
})

const bind = (model: LanguageModelV4): BoundModel => ({
  ref: { providerId: 'anthropic', modelId: 'fake-1' },
  model,
  profile: { namespace: 'anthropic', cacheBreakpoints: false, temperature: true },
  origin: { api: 'anthropic-messages', provider: 'anthropic', model: 'fake-1' },
  subscription: false,
})

const request = (): ModelTurnRequest => ({
  systemPrompt: 's',
  messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
  tools: [],
  signal: new AbortController().signal,
})

const run = (model: LanguageModelV4, maxRetries = 2) =>
  createModelSession(bind(model), {
    sessionId: 's',
    retry: { maxRetries, maxDelayMs: 60_000 },
    silence: { firstPartMs: 30, betweenPartsMs: 30 },
  }).turn(request())

const apiError = (statusCode: number, body: string, headers: Record<string, string> = {}) =>
  new APICallError({
    message: body,
    url: 'https://x',
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    responseBody: JSON.stringify({ error: { message: body } }),
  })

// Anthropic's SDK reports a failure inside the stream as a plain object, not an Error.
const overloaded = {
  message: 'Overloaded',
  type: 'overloaded_error',
  statusCode: 529,
  isRetryable: true,
}

describe('a failure the host can classify', () => {
  test('a streamed failure keeps its words and its status, and is retryable', async () => {
    const { model } = recordingModel([
      parts([...text('par'), { type: 'error', error: overloaded }]),
    ])
    const turn = run(model)
    const message = await turn.message
    expect(message.errorMessage).toContain('Overloaded')
    expect(message.errorMessage).not.toContain('[object Object]')
    expect(classifyAgentError(turn.failure)).toMatchObject({ retryable: true })
  })

  test('a streamed failure before any content is sent again', async () => {
    const { model, calls } = recordingModel([
      parts([{ type: 'error', error: overloaded }]),
      parts([...text('ok'), finish()]),
    ])
    const message = await createModelSession(bind(model), {
      sessionId: 's',
      retry: { maxRetries: 2, maxDelayMs: 1 },
    }).turn(request()).message
    expect(message.stopReason).toBe('end_turn')
    expect(calls).toHaveLength(2)
  })

  test.each([
    [500, 'upstream failure', { retryable: true }],
    [413, 'request entity too large', { kind: 'context_overflow', shouldCompress: true }],
    [401, 'invalid x-api-key', { authFailed: true, retryable: false }],
    [429, 'slow down', { rateLimited: true, retryable: true, retryAfterMs: 7_000 }],
  ])('an HTTP %d reaches the classifier with its status', (status, body, expected) => {
    const described = describeFailure(apiError(status, body, { 'retry-after': '7' }), 'anthropic')
    expect(described.message).toContain(`anthropic ${status}:`)
    expect(classifyAgentError(described)).toMatchObject(expected)
  })
})

describe('a stream given up on', () => {
  test('a silence deadline cancels the stream and aborts its request', async () => {
    let cancelled = false
    const { model, calls } = recordingModel([parts(text('a'), true, () => (cancelled = true))])
    const turn = run(model, 0)
    await turn.message
    expect(turn.failure?.name).toBe('StreamIdleTimeoutError')
    expect(cancelled).toBe(true)
    expect(calls[0]!.abortSignal?.aborted).toBe(true)
  })

  test('an error part cancels the stream', async () => {
    let cancelled = false
    const { model, calls } = recordingModel([
      parts([...text('a'), { type: 'error', error: overloaded }], true, () => (cancelled = true)),
    ])
    await run(model).message
    expect(cancelled).toBe(true)
    expect(calls[0]!.abortSignal?.aborted).toBe(true)
  })

  test('a finished stream is left alone', async () => {
    const { model, calls } = recordingModel([parts([...text('a'), finish()])])
    await run(model).message
    expect(calls[0]!.abortSignal?.aborted).toBe(false)
  })
})

describe('when to send a request again', () => {
  test('a stated window longer than an in-request wait is left to the host', async () => {
    const { model, calls } = recordingModel([apiError(429, 'limited', { 'retry-after': '120' })])
    const turn = run(model)
    await turn.message
    expect(calls).toHaveLength(1)
    expect(classifyAgentError(turn.failure)).toMatchObject({
      rateLimited: true,
      retryAfterMs: 120_000,
    })
  })

  test('silence before the first part is sent again', async () => {
    const { model, calls } = recordingModel([parts([], true), parts([...text('ok'), finish()])])
    const message = await createModelSession(bind(model), {
      sessionId: 's',
      retry: { maxRetries: 1, maxDelayMs: 1 },
      silence: { firstPartMs: 30, betweenPartsMs: 30 },
    }).turn(request()).message
    expect(message.stopReason).toBe('end_turn')
    expect(calls).toHaveLength(2)
  })

  test('a stream that closes without finishing is a named failure, resent when it carried nothing', async () => {
    const cut = recordingModel([parts(text('half'))])
    const turn = run(cut.model)
    await turn.message
    expect(turn.failure?.name).toBe('ProviderPrematureCloseError')
    expect(classifyAgentError(turn.failure)).toMatchObject({ retryable: true })

    const empty = recordingModel([parts([]), parts([...text('ok'), finish()])])
    const resent = await createModelSession(bind(empty.model), {
      sessionId: 's',
      retry: { maxRetries: 1, maxDelayMs: 1 },
    }).turn(request()).message
    expect(resent.stopReason).toBe('end_turn')
  })

  test('a filtered response is a named failure and is not resent', async () => {
    const { model, calls } = recordingModel([parts([finish('content-filter')])])
    const turn = run(model)
    expect((await turn.message).stopReason).toBe('error')
    expect(turn.failure?.name).toBe('ContentFilterError')
    expect(calls).toHaveLength(1)
  })

  test('only a network TypeError is a connection worth retrying', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryable(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(
      false,
    )
  })
})
