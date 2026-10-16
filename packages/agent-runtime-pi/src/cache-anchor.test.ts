/**
 * The prompt-cache anchor, end to end through the adapter: the wire flag survives the codec,
 * and the vendored `anthropic-messages` converter turns it into an explicit `cache_control`
 * breakpoint — within Anthropic's limit of four per request.
 *
 * The converter is the vendored package's own (`@earendil-works/pi-ai/api/anthropic-messages`):
 * this is the one place the flag becomes bytes on the wire, and a change there must fail here,
 * not in production.
 */
import { describe, expect, test } from 'bun:test'
import type { Message as PiMessage } from '@earendil-works/pi-ai'

import type { Message } from '@localixai/agent'

import { convertMessages } from '@earendil-works/pi-ai/api/anthropic-messages'
import { fromPiMessage, toPiMessage } from './message-codec'

const CACHE = { type: 'ephemeral' as const }

const user = (content: string, cacheAnchor?: boolean): Message => ({
  role: 'user',
  content,
  timestamp: 0,
  ...(cacheAnchor ? { cacheAnchor } : {}),
})

const assistant = (text: string, cacheAnchor?: boolean): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  model: 'm',
  timestamp: 0,
  ...(cacheAnchor ? { cacheAnchor } : {}),
})

/** pi 0.85 returns `{ messages, assistantLevels }`; these cases only assert on the messages. */
const convertMessagesOnly = (...args: Parameters<typeof convertMessages>) =>
  convertMessages(...args).messages

/** Count `cache_control` markers over every block of every converted message. */
function breakpoints(params: ReturnType<typeof convertMessages>['messages']): number {
  let count = 0
  for (const param of params) {
    if (!Array.isArray(param.content)) continue
    for (const block of param.content)
      if ((block as { cache_control?: unknown }).cache_control) count++
  }
  return count
}

describe('codec forwards the cache anchor', () => {
  test('user, assistant and the LAST tool result of a group carry it; others do not', () => {
    expect(toPiMessage(user('p', true))[0]).toMatchObject({ cacheAnchor: true })
    expect(toPiMessage(assistant('a', true))[0]).toMatchObject({ cacheAnchor: true })
    expect('cacheAnchor' in toPiMessage(user('p'))[0]!).toBe(false)
    const results = toPiMessage({
      role: 'tool',
      timestamp: 0,
      cacheAnchor: true,
      results: [
        { type: 'tool_result', toolCallId: 'a', toolName: 'read', content: 'x' },
        { type: 'tool_result', toolCallId: 'b', toolName: 'read', content: 'y' },
      ],
    })
    expect('cacheAnchor' in results[0]!).toBe(false)
    expect(results[1]).toMatchObject({ cacheAnchor: true })
    // Each context-policy request crosses both codec directions, including tool groups.
    for (const message of [
      ...toPiMessage(user('p', true)),
      ...toPiMessage(assistant('a', true)),
      ...results,
    ]) {
      const roundTrip = toPiMessage(fromPiMessage(message))[0]!
      expect(roundTrip.cacheAnchor).toBe(message.cacheAnchor)
    }
  })
})

describe('anthropic-messages places the anchor breakpoint', () => {
  const pi = (messages: Message[]): PiMessage[] => messages.flatMap((m) => toPiMessage(m))

  test('the anchored message gets cache_control; the final message keeps its own', () => {
    const params = convertMessagesOnly(
      pi([user('task'), assistant('worked', true), user('runtime context + Σ')]),
      false,
      CACHE,
    )
    expect(params).toHaveLength(3)
    const anchored = params[1]!
    expect(Array.isArray(anchored.content)).toBe(true)
    const blocks = anchored.content as Array<{ cache_control?: unknown }>
    expect(blocks[blocks.length - 1]!.cache_control).toEqual(CACHE)
    expect(breakpoints(params)).toBe(2)
  })

  test('an anchor on the final message is not doubled', () => {
    const params = convertMessagesOnly(pi([user('task'), user('only', true)]), false, CACHE)
    expect(breakpoints(params)).toBe(1)
  })

  test('without cacheControl no breakpoint is written, anchor or not', () => {
    const params = convertMessagesOnly(
      pi([user('task'), assistant('a', true), user('tail')]),
      false,
    )
    expect(breakpoints(params)).toBe(0)
  })

  test('a tool-result group is anchored as one param, on its last block', () => {
    const wire: Message[] = [
      user('task'),
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', id: 'c1', name: 'read', arguments: { path: 'a' } },
          { type: 'tool_call', id: 'c2', name: 'read', arguments: { path: 'b' } },
        ],
        model: 'm',
        timestamp: 0,
      },
      {
        role: 'tool',
        timestamp: 0,
        cacheAnchor: true,
        results: [
          { type: 'tool_result', toolCallId: 'c1', toolName: 'read', content: 'x' },
          { type: 'tool_result', toolCallId: 'c2', toolName: 'read', content: 'y' },
        ],
      },
      user('tail'),
    ]
    const params = convertMessagesOnly(pi(wire), false, CACHE)
    const group = params[2]!
    const blocks = group.content as Array<{ type: string; cache_control?: unknown }>
    expect(blocks.map((b) => b.type)).toEqual(['tool_result', 'tool_result'])
    expect(blocks[0]!.cache_control).toBeUndefined()
    expect(blocks[1]!.cache_control).toEqual(CACHE)
    expect(breakpoints(params)).toBe(2)
  })

  test('the request budget: system + last tool + anchor + final message = four, never five', () => {
    // The two message-level breakpoints are counted here; `buildParams` adds one on the
    // system prompt and one on the last tool definition (the OAuth identity block no longer
    // carries its own when a system prompt follows it — see anthropic-messages.ts).
    const params = convertMessagesOnly(
      pi([user('task'), assistant('a', true), assistant('b'), user('tail')]),
      true,
      CACHE,
    )
    expect(breakpoints(params)).toBe(2)
  })
})
