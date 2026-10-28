import { describe, expect, test } from 'bun:test'
import type { AssistantMessage, Message } from '@localixai/agent'

import { IMAGE_OMITTED } from './media'
import { buildPrompt, type WireProfile } from './prompt'

const origin = { api: 'anthropic-messages', provider: 'anthropic', model: 'claude-x' }
const anthropic: WireProfile = { namespace: 'anthropic', cacheBreakpoints: true, temperature: true }
const compatible: WireProfile = {
  namespace: 'deepseek',
  cacheBreakpoints: false,
  temperature: true,
  compatible: true,
}
const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA' }

const assistant = (overrides: Partial<AssistantMessage>): AssistantMessage => ({
  role: 'assistant',
  api: origin.api,
  provider: origin.provider,
  model: origin.model,
  timestamp: 0,
  content: [],
  ...overrides,
})

const toolTurn = (content: Message[]): Message[] => [
  { role: 'user', content: 'go', timestamp: 0 },
  assistant({ content: [{ type: 'tool_call', id: 'c1', name: 'shot', arguments: {} }] }),
  ...content,
]

const shot = (isError = false): Message => ({
  role: 'tool',
  timestamp: 0,
  results: [
    {
      type: 'tool_result',
      toolCallId: 'c1',
      toolName: 'shot',
      content: [{ type: 'text', text: 'captured' }, image],
      isError,
    },
  ],
})

describe('images in a request', () => {
  test('a model that cannot read them gets a placeholder, in history and in tool results', () => {
    const prompt = buildPrompt(
      {
        systemPrompt: 's',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'see' }, image], timestamp: 0 },
          ...toolTurn([shot()]).slice(1),
        ],
      },
      { ...anthropic, images: false },
      origin,
    )
    expect(prompt[1]!.content).toEqual([
      { type: 'text', text: 'see' },
      { type: 'text', text: IMAGE_OMITTED },
    ])
    expect(prompt[3]).toMatchObject({
      role: 'tool',
      content: [
        {
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'captured' },
              { type: 'text', text: IMAGE_OMITTED },
            ],
          },
        },
      ],
    })
  })

  test('the OpenAI-compatible wire carries a tool image in a user message after the result', () => {
    const prompt = buildPrompt({ systemPrompt: 's', messages: toolTurn([shot()]) }, compatible, {
      provider: 'deepseek',
      model: 'm',
    })
    const [, , , tool, attached] = prompt
    expect(tool).toMatchObject({
      role: 'tool',
      content: [{ output: { type: 'text', value: 'captured\n(see the attached image)' } }],
    })
    expect(attached).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Attached image(s) from tool result:' },
        { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'AAAA' } },
      ],
    })
  })

  test('a failed result keeps its error flag and says what it left out', () => {
    const prompt = buildPrompt(
      { systemPrompt: 's', messages: toolTurn([shot(true)]) },
      anthropic,
      origin,
    )
    expect(prompt[3]).toMatchObject({
      content: [
        {
          output: {
            type: 'error-text',
            value: 'captured\n(1 attachment omitted from this failed result)',
          },
        },
      ],
    })
  })
})

describe('an assistant message replayed', () => {
  const signed = 'aisdk:{"anthropic":{"signature":"sig"}}'

  test('a response that failed or was stopped goes back without its reasoning or provider state', () => {
    for (const stopReason of ['error', 'aborted'] as const) {
      const prompt = buildPrompt(
        {
          systemPrompt: 's',
          messages: [
            assistant({
              stopReason,
              content: [
                { type: 'thinking', thinking: 'half', thinkingSignature: signed },
                { type: 'text', text: 'partial', textSignature: 'aisdk:{"openai":{"itemId":"m"}}' },
              ],
            }),
          ],
        },
        anthropic,
        origin,
      )
      expect(prompt[1]!.content).toEqual([{ type: 'text', text: 'partial' }])
    }
  })

  test('the same model gets its signed reasoning back, whatever namespace signed it', () => {
    const gateway: WireProfile = {
      namespace: 'gateway',
      cacheBreakpoints: false,
      temperature: true,
    }
    const prompt = buildPrompt(
      {
        systemPrompt: 's',
        messages: [
          assistant({ content: [{ type: 'thinking', thinking: 't', thinkingSignature: signed }] }),
        ],
      },
      gateway,
      origin,
    )
    expect(prompt[1]!.content).toEqual([
      { type: 'reasoning', text: 't', providerOptions: { anthropic: { signature: 'sig' } } },
    ])
  })

  test('unsigned reasoning returns only on the OpenAI-compatible wire, and only to its model', () => {
    const message = assistant({
      provider: 'deepseek',
      model: 'm',
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'tool_call', id: 'c1', name: 'read', arguments: {} },
      ],
    })
    const own = buildPrompt({ systemPrompt: 's', messages: [message] }, compatible, {
      provider: 'deepseek',
      model: 'm',
    })
    expect(own[1]!.content[0]).toEqual({ type: 'reasoning', text: 'plan' })
    const other = buildPrompt({ systemPrompt: 's', messages: [message] }, compatible, {
      provider: 'deepseek',
      model: 'other',
    })
    expect((other[1]!.content as Array<{ type: string }>).map((part) => part.type)).toEqual([
      'tool-call',
    ])
    const signedOnly = buildPrompt({ systemPrompt: 's', messages: [message] }, anthropic, {
      provider: 'deepseek',
      model: 'm',
    })
    expect((signedOnly[1]!.content as Array<{ type: string }>).map((part) => part.type)).toEqual([
      'tool-call',
    ])
  })
})

describe('provider rules', () => {
  test('tool-call ids are rewritten into the form a strict provider takes, calls and results alike', () => {
    const messages: Message[] = [
      assistant({
        content: [{ type: 'tool_call', id: 'functions.read:0', name: 'read', arguments: {} }],
      }),
      {
        role: 'tool',
        timestamp: 0,
        results: [
          { type: 'tool_result', toolCallId: 'functions.read:0', toolName: 'read', content: 'ok' },
        ],
      },
    ]
    const claude = buildPrompt(
      { systemPrompt: 's', messages },
      { ...anthropic, toolCallIds: 'anthropic' },
      origin,
    )
    const callId = (claude[1]!.content[0] as { toolCallId: string }).toolCallId
    expect(callId).toBe('functions_read_0')
    expect((claude[2]!.content[0] as { toolCallId: string }).toolCallId).toBe(callId)
    const mistral = buildPrompt(
      { systemPrompt: 's', messages },
      { ...compatible, toolCallIds: 'mistral' },
      origin,
    )
    const mistralId = (mistral[1]!.content[0] as { toolCallId: string }).toolCallId
    expect(mistralId).toMatch(/^[a-zA-Z0-9]{9}$/u)
    expect((mistral[2]!.content[0] as { toolCallId: string }).toolCallId).toBe(mistralId)
  })

  test('Claude on Bedrock reads Bedrock cache points at the same anchors', () => {
    const prompt = buildPrompt(
      {
        systemPrompt: 's',
        messages: [
          { role: 'user', content: 'hi', timestamp: 0, cacheAnchor: true },
          { role: 'user', content: 'now', timestamp: 0 },
        ],
      },
      { namespace: 'bedrock', cacheBreakpoints: true, cachePoints: 'bedrock', temperature: true },
      origin,
    )
    const point = { bedrock: { cachePoint: { type: 'default' } } }
    expect(prompt.map((message) => message.providerOptions)).toEqual([point, point, point])
  })

  test('Anthropic reads the system prompt back at its own breakpoint, so another session’s first request hits it', () => {
    const first = (text: string) =>
      buildPrompt(
        {
          systemPrompt: 'stable system',
          messages: [{ role: 'user', content: text, timestamp: 0 }],
        },
        anthropic,
        origin,
      )
    const [a, b] = [first('fix the parser'), first('write the release notes')]
    // Tools and system come before every message, so a breakpoint on the system entry names a
    // prefix that two sessions with different first messages still share.
    expect(a[0]).toEqual(b[0]!)
    expect(a[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } })
    expect(a[1]).not.toEqual(b[1]!)
  })
})
