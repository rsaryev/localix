import { describe, expect, test } from 'bun:test'

import type { Message } from '@localixai/agent'

import { fromPiMessage, toPiMessage } from './message-codec'

describe('pi message codec', () => {
  test('round-trips assistant content, stop reason and accounting fields', () => {
    const message: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking', textSignature: 'text-sig' },
        {
          type: 'thinking',
          thinking: '',
          thinkingSignature: 'thinking-sig',
          redacted: true,
        },
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'read',
          arguments: { path: 'a.txt' },
          thoughtSignature: 'tool-sig',
        },
        { type: 'text', text: 'done' },
      ],
      api: 'openai-completions',
      provider: 'test-provider',
      model: 'test-model',
      responseModel: 'routed-model',
      responseId: 'response-42',
      diagnostics: [
        {
          type: 'stream-recovered',
          message: 'socket resumed',
          timestamp: 41,
          error: { name: 'SocketError', message: 'socket resumed', code: 'ECONNRESET' },
          details: { attempt: 2 },
        },
      ],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 15,
        outputTokens: 4,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        cacheWrite1hTokens: 1,
        reasoningTokens: 2,
        totalTokens: 19,
        totalCost: 0.5,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1, total: 0.5 },
      },
      timestamp: 42,
    }

    const encoded = toPiMessage(message)[0]!
    expect(encoded).toMatchObject({ role: 'assistant', stopReason: 'toolUse' })
    expect(fromPiMessage(encoded)).toEqual(message)
  })

  test('keeps Pi cache buckets exclusive while Localix input includes the full prompt', () => {
    const decoded = fromPiMessage({
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'test',
      model: 'test',
      stopReason: 'stop',
      timestamp: 1,
      usage: {
        input: 100,
        cacheRead: 900,
        cacheWrite: 50,
        cacheWrite1h: 25,
        reasoning: 10,
        output: 20,
        totalTokens: 1070,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    })
    expect(decoded?.role).toBe('assistant')
    if (decoded?.role !== 'assistant') throw new Error('expected assistant message')
    expect(decoded.usage).toMatchObject({
      inputTokens: 1050,
      cacheWrite1hTokens: 25,
      reasoningTokens: 10,
    })
    const roundTrip = toPiMessage(decoded)[0]
    expect(roundTrip?.role).toBe('assistant')
    if (roundTrip?.role !== 'assistant') throw new Error('expected Pi assistant')
    expect(roundTrip.usage).toMatchObject({ input: 100, cacheWrite1h: 25, reasoning: 10 })
  })

  test('expands a local batched tool message into pi tool-result messages', () => {
    const message: Message = {
      role: 'tool',
      results: [
        {
          type: 'tool_result',
          toolCallId: 'one',
          toolName: 'read',
          content: 'first',
          details: { path: 'a' },
        },
        {
          type: 'tool_result',
          toolCallId: 'two',
          toolName: 'read',
          content: 'second',
          isError: true,
        },
      ],
      timestamp: 7,
    }

    expect(toPiMessage(message)).toMatchObject([
      { role: 'toolResult', toolCallId: 'one', isError: false },
      { role: 'toolResult', toolCallId: 'two', isError: true },
    ])
  })
})

/**
 * SHAPE CONTRACT — pinned because a consumer branches on it.
 *
 * `fromPiMessage` builds tool `content` as an ARRAY of parts, never a bare string, and
 * `transformContext` (runtime.ts) hands exactly these objects to the host's context policy.
 * `pruneWireMessages` therefore has an array branch; it used to bail on any non-string, which
 * left the whole in-loop pruning layer inert in production. If this codec ever starts
 * emitting a string, that branch becomes dead code and this test says so.
 */
describe('tool-result content shape (pruning depends on it)', () => {
  test('fromPiMessage emits content PARTS, not a bare string', () => {
    const [local] = [
      fromPiMessage({
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'read',
        content: [{ type: 'text', text: 'file bytes' }],
        isError: false,
        timestamp: 0,
      } as never),
    ]
    const result = (local as { results: Array<{ content: unknown }> }).results[0]!
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'file bytes' }])
  })

  test('a Localix STRING content survives the round trip as parts', () => {
    // Confirms the asymmetry rather than hiding it: string in, parts out.
    const pi = toPiMessage({
      role: 'tool',
      results: [{ type: 'tool_result', toolCallId: 'c2', toolName: 'read', content: 'plain' }],
      timestamp: 0,
    })
    const back = fromPiMessage(pi[0]! as never) as { results: Array<{ content: unknown }> }
    expect(back.results[0]!.content).toEqual([{ type: 'text', text: 'plain' }])
  })
})

/**
 * USAGE TOTALS — absence must not become a measured zero.
 *
 * pi's `Usage.totalTokens` is a required `number`, so the codec has to produce one. The
 * canonical rule lives in `normalizeUsage` (apps/api chat/runtime/usage-normalize.ts):
 * an absent total is DERIVED as `input + output`, and a literal `0` is accepted as
 * measured. So emitting `0` for "not reported" suppresses that derivation for every
 * downstream reader instead of letting it fill the gap.
 */
describe('assistant usage totals', () => {
  const assistantWith = (usage: Record<string, number>) =>
    toPiMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
      model: 'm',
      timestamp: 0,
      usage: usage as never,
    } as never)[0] as { usage: { totalTokens: number; input: number; output: number } }

  test('derives an absent totalTokens as input + output, not 0', () => {
    const pi = assistantWith({ inputTokens: 120, outputTokens: 30 })
    expect(pi.usage.totalTokens).toBe(150)
  })

  test('keeps a reported totalTokens verbatim, including a real zero', () => {
    expect(
      assistantWith({ inputTokens: 5, outputTokens: 7, totalTokens: 99 }).usage.totalTokens,
    ).toBe(99)
    // A provider that genuinely reported zero consumption stays zero.
    expect(
      assistantWith({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }).usage.totalTokens,
    ).toBe(0)
  })

  test('the derived total still holds when the cache buckets carry the input', () => {
    // Localix `inputTokens` is INCLUSIVE of cache; the derivation uses it as given
    // rather than the post-subtraction `input` pi receives.
    const pi = assistantWith({
      inputTokens: 1000,
      outputTokens: 50,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
    })
    expect(pi.usage.input).toBe(60)
    expect(pi.usage.totalTokens).toBe(1050)
  })
})
