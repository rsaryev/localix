import { describe, expect, test } from 'bun:test'
import type { Message, UiSession } from '@/shared/api/contracts'
import {
  copyOptions,
  helpOptions,
  replyText,
  resumeOptions,
  rewindOptions,
} from './clientCommandRows'

const message = (
  id: string,
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {},
) => ({ id, role, content, ...extra }) as Message
const chat = (id: string, title: string, updatedAt: number, extra: Partial<UiSession> = {}) =>
  ({
    id,
    title,
    seq: Number(id.replace(/\D/g, '')) || 1,
    updatedAt,
    isPinned: false,
    isArchived: false,
    sessionKind: 'chat',
    ...extra,
  }) as UiSession

describe('/rewind rows', () => {
  const transcript = [
    message('u1', 'user', 'first question'),
    message('a1', 'assistant', 'first answer'),
    message('u2', 'user', 'second\n   question with   spaces'),
    message('x1', 'user', 'machine prompt', { isInternal: true }),
    message('a2', 'assistant', 'second answer'),
    message('u3', 'user', 'a '.repeat(80)),
  ]

  test('offers the messages you wrote, newest first, as one-line previews', () => {
    const rows = rewindOptions(transcript, '')
    expect(rows.map((row) => row.value)).toEqual(['u3', 'u2', 'u1'])
    expect(rows[1]!.label).toBe('second question with spaces')
    expect(rows[0]!.label.length).toBeLessThanOrEqual(61)
    expect(rows[0]!.label.endsWith('…')).toBe(true)
  })

  test('narrows by what you remember of the message', () => {
    expect(rewindOptions(transcript, 'FIRST').map((row) => row.value)).toEqual(['u1'])
  })
})

describe('/copy rows', () => {
  const transcript = [
    message('u1', 'user', 'q'),
    message('a1', 'assistant', 'old reply'),
    message('u2', 'user', 'q2'),
    message('a2', 'assistant', 'part one'),
    message('a3', 'assistant', 'part two', { continuedFromMessageId: 'a2' }),
  ]

  test('counts a continued answer as one reply, newest first', () => {
    expect(copyOptions(transcript, '').map((row) => [row.value, row.label])).toEqual([
      ['1', 'part one part two'],
      ['2', 'old reply'],
    ])
  })

  test('hands over exactly what the card’s Copy text copies', () => {
    expect(replyText(transcript, 1)).toBe('part one\n\npart two')
    expect(replyText(transcript, 2)).toBe('old reply')
    expect(replyText(transcript, 3)).toBeNull()
  })
})

describe('/resume rows', () => {
  const sessions = [
    chat('c1', 'Older chat', 100),
    chat('c2', 'Newest chat', 300),
    chat('c3', 'Current chat', 200),
    chat('c4', 'Archived', 400, { isArchived: true }),
    chat('c5', 'A sub-agent', 500, { parentSessionId: 'c1' }),
  ]

  test('lists the other chats the switcher would offer, most recent first', () => {
    expect(resumeOptions(sessions, 'c3', '').map((row) => row.value)).toEqual(['c2', 'c1'])
  })

  test('narrows by title', () => {
    expect(resumeOptions(sessions, 'c3', 'older').map((row) => row.label)).toEqual(['Older chat'])
  })
})

describe('/help rows', () => {
  test('names the commands the menu shows, not the hidden ones', () => {
    const names = helpOptions('').map((row) => row.value)
    expect(names).toContain('plugin')
    expect(names).toContain('rewind')
    expect(names).not.toContain('reload-plugins')
    expect(helpOptions('rew').map((row) => row.value)).toEqual(['rewind'])
  })
})
