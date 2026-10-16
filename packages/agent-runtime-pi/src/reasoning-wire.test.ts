/**
 * The reasoning level a person picks, as it reaches the provider request bytes.
 *
 * Two hops are pinned here, both against the vendored `anthropic-messages` adapter itself,
 * because that is where a level becomes `output_config.effort` on the wire:
 *
 * - `off` on a model that cannot switch reasoning off. Sending no level leaves the provider's
 *   default in charge, which on Anthropic's managed-effort models is `high`: Off reasoned more
 *   than Low did.
 * - A past turn's level, across the Localix codec. Managed-effort models bind signed thinking to
 *   the level it was produced at; pi replays a historical marker only when the message still
 *   carries `providerThinkingLevel`. The context policy round-trips every request through the
 *   Localix codec, so a dropped field silently invalidated every earlier thinking block below
 *   `high` (`drop_block`) on every turn of a tool loop.
 */
import { describe, expect, test } from 'bun:test'
import type { Model as PiModel } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/anthropic-messages'
import * as openAIResponses from '@earendil-works/pi-ai/api/openai-responses'
import { normalizeContext } from '@earendil-works/pi-ai/compat'

import type { AgentMessage } from '@localixai/agent/agents'
import type { Message } from '@localixai/agent'

import { fromPiMessage } from './message-codec'
import { resolveReasoningEffort } from './preflight'
import { createContextTransform, toPiMessages } from './runtime-context'

/** Shaped like the catalog's Haiku 5.5 / Opus 5.5 on Anthropic or OpenRouter. */
const managed = {
  id: 'claude-managed',
  name: 'Managed',
  api: 'anthropic-messages',
  provider: 'openrouter',
  baseUrl: 'http://127.0.0.1:9',
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
  compat: { forceAdaptiveThinking: true, supportsMidConvoEffort: true },
} as unknown as PiModel<'anthropic-messages'>

interface WirePayload {
  messages: Array<{ role: string; output_config?: { effort?: string } }>
}

async function capture(
  messages: Parameters<typeof normalizeContext>[0]['messages'],
  reasoning: ReturnType<typeof resolveReasoningEffort>['effort'],
): Promise<WirePayload> {
  let payload: WirePayload | undefined
  await streamSimple(managed, normalizeContext({ messages }), {
    apiKey: 'test-key',
    cacheRetention: 'none',
    reasoning,
    onPayload: (value) => {
      payload = value as WirePayload
      throw new Error('captured')
    },
  }).result()
  if (!payload) throw new Error('no payload captured')
  return payload
}

const efforts = (payload: WirePayload) =>
  payload.messages.filter((m) => m.role === 'system').map((m) => m.output_config?.effort)

const user = (content: string): Message => ({ role: 'user', content, timestamp: 1 })

describe('off on a model that cannot switch reasoning off', () => {
  test('asks for the least reasoning the model offers, not the provider default', async () => {
    const resolved = resolveReasoningEffort(managed, 'off')
    expect(resolved).toEqual({ effort: 'low', clampedFrom: 'off' })
    expect(efforts(await capture(toPiMessages([user('hi')]), resolved.effort))).toEqual(['low'])
  })

  test('without the clamp the same request would run at high — the bug this pins', async () => {
    expect(efforts(await capture(toPiMessages([user('hi')]), undefined))).toEqual(['high'])
  })

  test('a model that declares off keeps asking for none', () => {
    const declaresOff = { ...managed, thinkingLevelMap: { off: 'none' } } as typeof managed
    expect(resolveReasoningEffort(declaresOff, 'off')).toEqual({ effort: undefined })
  })
})

describe('a past turn keeps its level across the Localix codec', () => {
  const lowTurn: Message = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'brief', thinkingSignature: 'sig' },
      { type: 'text', text: 'answer' },
    ],
    api: 'anthropic-messages',
    provider: 'openrouter',
    model: 'claude-managed',
    providerThinkingLevel: 'low',
    stopReason: 'end_turn',
    timestamp: 1,
  }

  test('stored history replays the historical marker before the turn', async () => {
    const payload = await capture(toPiMessages([user('one'), lowTurn, user('two')]), 'medium')
    expect(efforts(payload)).toEqual(['low', 'medium'])
  })

  test('a context-policy round trip mid-run keeps it too', async () => {
    const transform = createContextTransform(
      { contextPolicy: { transform: async (messages: AgentMessage[]) => messages } },
      new AbortController().signal,
    )!
    const piMessages = toPiMessages([user('one'), lowTurn, user('two')])
    const transformed = await transform(piMessages)
    expect(fromPiMessage(transformed[1] as never)).toMatchObject({ providerThinkingLevel: 'low' })
    expect(efforts(await capture(transformed as never, 'medium'))).toEqual(['low', 'medium'])
  })
})

describe('OpenAI Responses (gpt-6.1-sol shape)', () => {
  // Catalog and OpenRouter both publish `off: null, minimal: null` for gpt-6.1-sol: reasoning
  // cannot be switched off, and an omitted effort leaves OpenAI's own default in charge.
  const sol = {
    id: 'gpt-6.1-sol',
    name: 'Sol',
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'http://127.0.0.1:9',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high' },
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  } as unknown as PiModel<'openai-responses'>

  interface ResponsesPayload {
    reasoning?: { effort?: string }
    store?: boolean
    include?: string[]
    input: Array<{ type?: string; id?: string; encrypted_content?: string }>
  }

  async function payloadFor(messages: Message[], requested: string): Promise<ResponsesPayload> {
    let payload: ResponsesPayload | undefined
    await openAIResponses
      .streamSimple(sol, normalizeContext({ messages: toPiMessages(messages) }), {
        apiKey: 'test-key',
        reasoning: resolveReasoningEffort(sol, requested).effort,
        onPayload: (value) => {
          payload = value as ResponsesPayload
          throw new Error('captured')
        },
      })
      .result()
    if (!payload) throw new Error('no payload captured')
    return payload
  }

  test.each([
    ['off', 'low'],
    ['low', 'low'],
    ['medium', 'medium'],
  ])('%s is sent as reasoning.effort %s', async (requested, sent) => {
    const payload = await payloadFor([user('hi')], requested)
    expect(payload.reasoning?.effort).toBe(sent)
    expect(payload.store).toBe(false)
    expect(payload.include).toContain('reasoning.encrypted_content')
  })

  test('a stored turn replays its encrypted reasoning item, id and all', async () => {
    const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAA' }
    const turn: Message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', thinkingSignature: JSON.stringify(reasoningItem) },
        { type: 'text', text: 'answer' },
      ],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-6.1-sol',
      stopReason: 'end_turn',
      timestamp: 1,
    }
    const payload = await payloadFor([user('one'), turn, user('two')], 'low')
    expect(payload.input.filter((item) => item.type === 'reasoning')).toEqual([reasoningItem])
  })
})
