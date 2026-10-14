import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../../db/payload'
import { colleagueLine } from './history/stages/participant-audience'
import { appendSpokenText, publishedText } from './spoken-text'

type Items = NonNullable<StoredMessagePayload['items']>

/** LOCALIX-136: the leader addressed two colleagues, called `ask`, then wrote a closing line. */
const leaderTurn: Pick<StoredMessagePayload, 'content' | 'items'> = {
  content: 'I asked the person a few questions.',
  items: [
    { id: 'r0', type: 'reasoning', status: 'completed', text: 'Inviting team members' },
    { id: 't0', type: 'text', status: 'completed', text: '@design Draft the concept.' },
    {
      id: 'c1',
      type: 'tool_call',
      status: 'completed',
      name: 'ask',
      toolCallId: 'c1',
      input: {},
    },
    { id: 't1', type: 'text', status: 'completed', text: '\n\n' },
    { id: 't2', type: 'text', status: 'completed', text: 'I asked the person a few questions.' },
  ] as Items,
}

describe('publishedText', () => {
  test('keeps an address written before a tool call (LOCALIX-136)', () => {
    expect(publishedText(leaderTurn)).toBe(
      '@design Draft the concept.\n\nI asked the person a few questions.',
    )
  })

  test('falls back to content for a row without text items', () => {
    expect(publishedText({ content: ' Done. ', items: [] })).toBe('Done.')
  })

  test('colleagues read the whole turn, not only its last model call', () => {
    const payload = {
      id: 'a1',
      role: 'assistant',
      from: 'agent:builtin:localix',
      ...leaderTurn,
    } as StoredMessagePayload
    expect(colleagueLine(payload)).toContain('@design Draft the concept.')
  })
})

describe('appendSpokenText', () => {
  test('a new text part starts a paragraph; fragments of one part and existing whitespace join as is', () => {
    expect(appendSpokenText('сообщи файлы.', 'Поручил frontend_builder', true)).toBe(
      'сообщи файлы.\n\nПоручил frontend_builder',
    )
    expect(appendSpokenText('A.', 'B', false)).toBe('A.B')
    expect(appendSpokenText('A.\n', 'B', true)).toBe('A.\nB')
    expect(appendSpokenText('Building the team: ', 'design drafts it.', true)).toBe(
      'Building the team: design drafts it.',
    )
    expect(appendSpokenText('', 'B', true)).toBe('B')
  })
})
