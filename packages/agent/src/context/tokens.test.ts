import { describe, expect, test } from 'bun:test'
import {
  IMAGE_TOKEN_ESTIMATE,
  estimateItemTokens,
  estimateItemResultTokens,
  estimateChatMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
} from './tokens'
import { msg, toolItem, namedTool, imageAttachment, textAttachment } from './_test-helpers'
import type { AgentItem } from '../agents/items'

const CHARS_PER_TOKEN = 4
const ceilTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

describe('IMAGE_TOKEN_ESTIMATE', () => {
  test('is the documented flat 1600 allowance', () => {
    expect(IMAGE_TOKEN_ESTIMATE).toBe(1600)
  })
})

describe('estimateTextTokens', () => {
  test('uses UTF-8 bytes so non-ASCII text is not undercounted as JS code units', () => {
    // 你 + 好 = 6 UTF-8 bytes; 🙂 = 4 more. ceil(10 / 4) = 3.
    expect(estimateTextTokens('你好🙂')).toBe(3)
    expect(estimateTextTokens('ascii')).toBe(2)
  })
})

describe('estimateItemResultTokens', () => {
  test('counts model-facing result text at ~4 UTF-8 bytes/token', () => {
    const text = 'y'.repeat(40)
    expect(estimateItemResultTokens(toolItem({ resultText: text, input: undefined }))).toBe(
      ceilTokens(40),
    )
  })

  test('is monotonic in result length', () => {
    const short = estimateItemResultTokens(
      toolItem({ resultText: 'z'.repeat(20), input: undefined }),
    )
    const long = estimateItemResultTokens(
      toolItem({ resultText: 'z'.repeat(2000), input: undefined }),
    )
    expect(long).toBeGreaterThan(short)
  })

  test('is zero for an empty result', () => {
    expect(estimateItemResultTokens(toolItem({ resultText: '', input: undefined }))).toBe(0)
  })
})

describe('estimateItemTokens', () => {
  test('counts JSON-stringified input plus result text', () => {
    const input = { path: 'src/a.ts' }
    const result = 'r'.repeat(80)
    const inputChars = JSON.stringify(input).length
    const expected = ceilTokens(inputChars + result.length)
    expect(estimateItemTokens(namedTool('read', input, { resultText: result }))).toBe(expected)
  })

  test('is monotonic in result length (input fixed)', () => {
    const input = { path: 'src/a.ts' }
    const a = estimateItemTokens(namedTool('read', input, { resultText: 'q'.repeat(100) }))
    const b = estimateItemTokens(namedTool('read', input, { resultText: 'q'.repeat(1000) }))
    expect(b).toBeGreaterThan(a)
  })

  test('handles missing input (treated as 0 input chars)', () => {
    const item = toolItem({ input: undefined, resultText: 'hello' })
    expect(estimateItemTokens(item)).toBe(ceilTokens('hello'.length))
  })
})

describe('estimateChatMessageTokens', () => {
  test('counts signed reasoning and opaque signatures that replay to the provider', () => {
    const signature = 's'.repeat(120)
    const thinking = 'r'.repeat(40)
    const toolSignature = 't'.repeat(80)
    const signedTool = namedTool('read', {}, { thoughtSignature: toolSignature })
    const m = msg({
      content: '',
      items: [
        {
          id: 'r-signed',
          type: 'reasoning',
          status: 'completed',
          text: thinking,
          thinkingSignature: signature,
        } as AgentItem,
        signedTool,
      ],
    })
    expect(estimateChatMessageTokens(m)).toBe(
      ceilTokens(thinking.length + signature.length) + estimateItemTokens(signedTool),
    )
    expect(estimateChatMessageTokens(m)).toBeGreaterThan(0)
  })

  test('counts an empty signed text block even when visible content is empty', () => {
    const m = msg({
      content: '',
      items: [
        {
          id: 't-signed',
          type: 'text',
          status: 'completed',
          text: '',
          textSignature: 'x'.repeat(64),
        } as AgentItem,
      ],
    })
    expect(estimateChatMessageTokens(m)).toBe(ceilTokens(64))
  })

  test('counts message text content', () => {
    const m = msg({ role: 'user', content: 'a'.repeat(40) })
    expect(estimateChatMessageTokens(m)).toBe(ceilTokens(40))
  })

  test('adds IMAGE_TOKEN_ESTIMATE per image attachment', () => {
    const m = msg({
      role: 'user',
      content: '',
      bindings: [imageAttachment(), imageAttachment('b.png')],
    })
    expect(estimateChatMessageTokens(m)).toBe(2 * IMAGE_TOKEN_ESTIMATE)
  })

  test('counts text attachments as UTF-8 bytes, not image tokens', () => {
    const text = 'w'.repeat(80)
    const m = msg({ role: 'user', content: '', bindings: [textAttachment(text)] })
    expect(estimateChatMessageTokens(m)).toBe(ceilTokens(80))
    expect(estimateChatMessageTokens(m)).toBeLessThan(IMAGE_TOKEN_ESTIMATE)
  })

  test('counts the exact model-facing envelope of resolved context bindings', () => {
    const content = 'CREATE TABLE users ();'.repeat(20)
    const m = msg({
      role: 'user',
      content: '@resource:localix://resource/fixture-db/users',
      bindings: [
        {
          kind: 'context',
          id: 'binding-1',
          source: 'mention',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/fixture-db/users',
            label: 'users',
          },
          resolution: {
            status: 'resolved',
            contributions: [
              {
                id: 'contribution-1',
                providerId: 'fixture:context',
                providerVersion: '1',
                scope: 'session',
                kind: 'database-schema',
                content,
                revision: 'r7',
                sensitivity: 'project',
              },
            ],
          },
        },
      ],
    })
    const envelope = `--- Context (database-schema; provider=fixture:context@1 revision=r7) ---\n${content}\n--- End context ---`

    expect(estimateChatMessageTokens(m)).toBe(
      ceilTokens('@resource:localix://resource/fixture-db/users'.length + envelope.length),
    )
  })

  test('sums content + tool input + tool result', () => {
    const content = 'c'.repeat(20)
    const input = { path: 'x.ts' }
    const result = 'r'.repeat(40)
    const m = msg({ content, items: [namedTool('read', input, { resultText: result })] })
    const expected =
      ceilTokens(content.length) +
      estimateItemTokens(namedTool('read', input, { resultText: result }))
    expect(estimateChatMessageTokens(m)).toBe(expected)
  })

  test('excludes reasoning from the estimate', () => {
    const withReasoning = msg({ role: 'user', content: 'hi', reasoning: 'x'.repeat(10000) })
    const without = msg({ role: 'user', content: 'hi' })
    expect(estimateChatMessageTokens(withReasoning)).toBe(estimateChatMessageTokens(without))
  })

  test('counts assistant text ITEMS even when the content mirror is empty (items-only history)', () => {
    // A CLI-adapter / external sub-agent turn leaves `content` empty but carries the
    // narrative as a `text` item — the wire (toModelMessages) still sends it, so the
    // estimate must too, or the budget undercounts and the window can overflow.
    const text = 't'.repeat(120)
    const m = msg({
      content: '',
      items: [{ id: 'x1', type: 'text', text } as unknown as AgentItem],
    })
    expect(estimateChatMessageTokens(m)).toBe(ceilTokens(120))
  })

  test('does not double-count when content mirrors the text item (the common case)', () => {
    // Our own turns set content === concatenated text items; take the larger, not the sum.
    const text = 'm'.repeat(80)
    const m = msg({
      content: text,
      items: [{ id: 'x2', type: 'text', text } as unknown as AgentItem],
    })
    expect(estimateChatMessageTokens(m)).toBe(ceilTokens(80))
  })
})

describe('estimateMessagesTokens', () => {
  test('sums per-message estimates', () => {
    const messages = [
      msg({ role: 'user', content: 'a'.repeat(40) }),
      msg({ content: 'b'.repeat(80) }),
    ]
    const expected = messages.reduce((s, m) => s + estimateChatMessageTokens(m), 0)
    expect(estimateMessagesTokens(messages)).toBe(expected)
    expect(estimateMessagesTokens(messages)).toBe(ceilTokens(40) + ceilTokens(80))
  })

  test('is zero for an empty conversation', () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })
})
