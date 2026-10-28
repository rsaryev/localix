import { describe, expect, test } from 'bun:test'
import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import { providerResponseOf } from '@localixai/agent/agents'
import type { ModelTurnRequest } from '@localixai/agent/runtime'

import { createModelSession, type BoundModel } from './session'
import type { WireProfile } from './wire/prompt'

const usage = {
  inputTokens: { total: 1_000, noCache: 600, cacheRead: 400, cacheWrite: 0 },
  outputTokens: { total: 50, text: 40, reasoning: 10 },
}
const finish = (unified: 'stop' | 'tool-calls' | 'length' = 'stop'): LanguageModelV4StreamPart => ({
  type: 'finish',
  usage,
  finishReason: { unified, raw: unified },
})

type Attempt =
  | LanguageModelV4StreamPart[]
  | Error
  | ((options: LanguageModelV4CallOptions) => ReadableStream<LanguageModelV4StreamPart>)

function fakeModel(attempts: Attempt[]) {
  const calls: LanguageModelV4CallOptions[] = []
  const model = {
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'fake-1',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('not used')),
    async doStream(options: LanguageModelV4CallOptions) {
      calls.push(options)
      const attempt = attempts[calls.length - 1] ?? []
      if (attempt instanceof Error) throw attempt
      if (typeof attempt === 'function') return { stream: attempt(options) }
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of attempt) controller.enqueue(part)
            controller.close()
          },
        }),
      }
    },
  } as unknown as LanguageModelV4
  return { model, calls }
}

const anthropicProfile: WireProfile = {
  namespace: 'anthropic',
  cacheBreakpoints: true,
  temperature: true,
}

function bind(model: LanguageModelV4, profile: WireProfile = anthropicProfile): BoundModel {
  return {
    ref: { providerId: 'fake', modelId: 'fake-1' },
    model,
    profile,
    origin: { api: 'anthropic-messages', provider: 'fake', model: 'fake-1' },
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    subscription: false,
  }
}

const request = (overrides: Partial<ModelTurnRequest> = {}): ModelTurnRequest => ({
  systemPrompt: 'be brief',
  messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
  tools: [],
  signal: new AbortController().signal,
  ...overrides,
})

const fastRetry = { maxRetries: 2, maxDelayMs: 1 }

describe('a model session turn', () => {
  test('assembles text, signed reasoning and a tool call; prices the usage', async () => {
    const { model } = fakeModel([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'thinking' },
        { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'sig-1' } } },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Hello' },
        { type: 'text-end', id: 't' },
        { type: 'tool-input-start', id: 'c1', toolName: 'read' },
        { type: 'tool-input-delta', id: 'c1', delta: '{"path":"a.ts","li' },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'read',
          input: '{"path":"a.ts","limit":5}',
        },
        finish('tool-calls'),
      ],
    ])
    const turn = createModelSession(bind(model), { sessionId: 's' }).turn(request())
    const deltas = []
    for await (const delta of turn) deltas.push(delta)
    const message = await turn.message

    expect(message.stopReason).toBe('tool_use')
    expect(message.content).toEqual([
      {
        type: 'thinking',
        thinking: 'thinking',
        thinkingSignature: 'aisdk:{"anthropic":{"signature":"sig-1"}}',
      },
      { type: 'text', text: 'Hello' },
      { type: 'tool_call', id: 'c1', name: 'read', arguments: { path: 'a.ts', limit: 5 } },
    ])
    // A tool input streams as far as it parses, so a card can show it before it is complete.
    expect(
      deltas.find((delta) => delta.kind === 'tool_call' && delta.phase === 'delta'),
    ).toMatchObject({ input: { path: 'a.ts' } })
    expect(message.usage).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 50,
      cacheReadTokens: 400,
      reasoningTokens: 10,
      costSource: 'estimated',
    })
    // 600 fresh × $3 + 400 cached × $0.30 + 50 out × $15, per million.
    expect(message.usage!.totalCost).toBeCloseTo((600 * 3 + 400 * 0.3 + 50 * 15) / 1e6, 10)
    expect(message.genTimings?.ttftMs).toBeGreaterThanOrEqual(0)
    expect(turn.failure).toBeUndefined()
  })

  test('a request that failed before producing anything is retried, honouring the stated window', async () => {
    const limited = new APICallError({
      message: 'rate limited',
      url: 'https://x',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { 'retry-after-ms': '0' },
      isRetryable: true,
    })
    const { model, calls } = fakeModel([
      limited,
      [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'ok' },
        { type: 'text-end', id: 't' },
        finish(),
      ],
    ])
    const turn = createModelSession(bind(model), { sessionId: 's', retry: fastRetry }).turn(
      request(),
    )
    expect((await turn.message).stopReason).toBe('end_turn')
    expect(calls).toHaveLength(2)
  })

  test('a failure after content is final, and carries the provider facts', async () => {
    const overloaded = new APICallError({
      message: 'overloaded',
      url: 'https://x',
      requestBodyValues: {},
      statusCode: 529,
      responseHeaders: { 'retry-after': '30' },
      isRetryable: true,
    })
    const { model, calls } = fakeModel([
      [
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'par' },
        { type: 'error', error: overloaded },
      ],
    ])
    const turn = createModelSession(bind(model), { sessionId: 's', retry: fastRetry }).turn(
      request(),
    )
    const message = await turn.message
    expect(calls).toHaveLength(1)
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toContain('overloaded')
    expect(providerResponseOf(turn.failure)).toMatchObject({
      status: 529,
      headers: { 'retry-after': '30' },
    })
  })

  test('cancellation settles as aborted, never as a failure', async () => {
    const controller = new AbortController()
    const { model } = fakeModel([
      (options) =>
        new ReadableStream({
          start(stream) {
            options.abortSignal?.addEventListener('abort', () => stream.error(new Error('aborted')))
          },
        }),
    ])
    const turn = createModelSession(bind(model), { sessionId: 's' }).turn(
      request({ signal: controller.signal }),
    )
    setTimeout(() => controller.abort(), 0)
    expect((await turn.message).stopReason).toBe('aborted')
    expect(turn.failure).toBeUndefined()
  })

  test('a provider that goes silent fails with the named idle error', async () => {
    const { model } = fakeModel([() => new ReadableStream({ start() {} })])
    const turn = createModelSession(bind(model), {
      sessionId: 's',
      retry: { maxRetries: 0, maxDelayMs: 1 },
      silence: { firstPartMs: 20, betweenPartsMs: 20 },
    }).turn(request())
    const message = await turn.message
    expect(message.stopReason).toBe('error')
    expect(turn.failure?.name).toBe('StreamIdleTimeoutError')
  })
})

describe('the request a turn sends', () => {
  test('replays reasoning only to the model that signed it, and caches the stable prefixes', async () => {
    const { model, calls } = fakeModel([[finish()]])
    await createModelSession(bind(model), { sessionId: 's' }).turn(
      request({
        messages: [
          { role: 'user', content: 'hi', timestamp: 0, cacheAnchor: true },
          {
            role: 'assistant',
            api: 'openai-responses',
            provider: 'openai',
            model: 'gpt-5',
            timestamp: 0,
            content: [
              {
                type: 'thinking',
                thinking: 'foreign',
                thinkingSignature: 'aisdk:{"openai":{"itemId":"rs_1"}}',
              },
              {
                type: 'text',
                text: 'Earlier.',
                textSignature: 'aisdk:{"openai":{"itemId":"m_1"}}',
              },
            ],
          },
          {
            role: 'assistant',
            api: 'anthropic-messages',
            provider: 'fake',
            model: 'fake-1',
            timestamp: 0,
            content: [
              {
                type: 'thinking',
                thinking: 'old',
                thinkingSignature: 'aisdk:{"anthropic":{"signature":"sig-1"}}',
              },
              { type: 'tool_call', id: 'c1', name: 'read', arguments: { path: 'a' } },
            ],
          },
          {
            role: 'tool',
            timestamp: 0,
            results: [
              {
                type: 'tool_result',
                toolCallId: 'c1',
                toolName: 'read',
                content: [
                  { type: 'text', text: 'see' },
                  { type: 'image', mediaType: 'image/png', data: 'AAAA' },
                ],
              },
            ],
          },
        ],
        tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }],
        reasoningEffort: 'off',
      }),
    ).message
    const sent = calls[0]!
    expect(sent.reasoning).toBe('none')
    expect(sent.tools).toEqual([
      { type: 'function', name: 'read', description: 'Read', inputSchema: { type: 'object' } },
    ])
    const [system, user, foreign, assistant, tool] = sent.prompt
    // Another model's reasoning and item ids are not sent; its words are.
    expect(foreign!.content).toEqual([{ type: 'text', text: 'Earlier.' }])
    expect(system).toMatchObject({
      role: 'system',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(user).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(assistant!.content).toEqual([
      {
        type: 'reasoning',
        text: 'old',
        providerOptions: { anthropic: { signature: 'sig-1' } },
      },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a' } },
    ])
    expect(tool).toMatchObject({
      role: 'tool',
      content: [
        {
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'see' },
              { type: 'file', mediaType: 'image/png' },
            ],
          },
        },
      ],
    })
  })
})
