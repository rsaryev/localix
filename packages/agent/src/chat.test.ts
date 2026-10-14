import { describe, expect, test } from 'bun:test'
import { safeJson, isLastAssistantMessage } from './chat'
import type { ChatMessage } from './chat'

describe('safeJson', () => {
  test('pretty-prints a plain value', () => {
    expect(safeJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  test('null / undefined become an empty object', () => {
    expect(safeJson(null)).toBe('{}')
    expect(safeJson(undefined)).toBe('{}')
  })

  test('falls back to String() on a circular structure (never throws)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => safeJson(circular)).not.toThrow()
    expect(safeJson(circular)).toBe('[object Object]')
  })
})

describe('isLastAssistantMessage', () => {
  const m = (id: string, role: 'user' | 'assistant') =>
    ({ id, role }) as Pick<ChatMessage, 'id' | 'role'>
  const convo = [m('u1', 'user'), m('a1', 'assistant'), m('u2', 'user'), m('a2', 'assistant')]

  test('true only for the final assistant message', () => {
    expect(isLastAssistantMessage(convo, m('a2', 'assistant'))).toBe(true)
    expect(isLastAssistantMessage(convo, m('a1', 'assistant'))).toBe(false)
  })

  test('false for a user message even if it is last', () => {
    expect(isLastAssistantMessage([m('a1', 'assistant'), m('u1', 'user')], m('u1', 'user'))).toBe(
      false,
    )
  })

  test('false when there are no assistant messages', () => {
    expect(isLastAssistantMessage([m('u1', 'user')], m('u1', 'user'))).toBe(false)
  })

  test('ignores trailing user messages — last ASSISTANT still wins', () => {
    const withTrailingUser = [...convo, m('u3', 'user')]
    expect(isLastAssistantMessage(withTrailingUser, m('a2', 'assistant'))).toBe(true)
  })
})
