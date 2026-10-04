import { describe, expect, test } from 'bun:test'
import { autoTitle, DEFAULT_TITLE } from './context'
import type { PersistedMessage } from '../contracts'

const msg = (role: 'user' | 'assistant', content: string): PersistedMessage =>
  ({ payload: { role, content } }) as unknown as PersistedMessage

describe('autoTitle', () => {
  test('keeps an existing, non-default title', () => {
    expect(autoTitle('My chat', [msg('user', 'hi')])).toBe('My chat')
  })

  test('derives from the first user message when the title is default', () => {
    expect(autoTitle(DEFAULT_TITLE, [msg('assistant', 'a'), msg('user', 'fix the bug')])).toBe(
      'fix the bug',
    )
  })

  test('ignores hidden command boundaries when naming a new chat', () => {
    const hidden = {
      payload: { role: 'user', content: '/clear', isInternal: true, contextBoundary: true },
    } as unknown as PersistedMessage
    expect(autoTitle(DEFAULT_TITLE, [hidden, msg('user', 'actual first task')])).toBe(
      'actual first task',
    )
  })

  test('an empty title also derives (treated like default)', () => {
    expect(autoTitle('', [msg('user', 'hello')])).toBe('hello')
  })

  test('truncates a long first message to 30 chars + ellipsis', () => {
    const out = autoTitle(DEFAULT_TITLE, [msg('user', 'x'.repeat(50))])
    expect(out).toBe('x'.repeat(30) + '...')
  })

  test('falls back to the current title when there is no user content', () => {
    expect(autoTitle(DEFAULT_TITLE, [])).toBe(DEFAULT_TITLE)
    expect(autoTitle(DEFAULT_TITLE, [msg('assistant', 'only assistant')])).toBe(DEFAULT_TITLE)
    expect(autoTitle(DEFAULT_TITLE, [msg('user', '')])).toBe(DEFAULT_TITLE) // empty content skipped
  })
})
