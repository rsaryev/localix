import { describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'

import { toMessages } from './toMessages'
import type { TranscriptTurn } from './types'

function text(id: string, value: string): AgentItem {
  return { id, status: 'completed', type: 'text', text: value }
}

function tool(id: string, name: string): AgentItem {
  return {
    id,
    status: 'completed',
    type: 'tool_call',
    toolCallId: id,
    name,
    activeVerb: 'Running',
    resultText: 'ok',
  }
}

const turns: readonly TranscriptTurn[] = [
  { role: 'user', items: [text('a', 'fix the auth bug')] },
  { role: 'assistant', items: [text('b', 'Looking into it.'), tool('c', 'Bash')] },
  { role: 'user', items: [text('d', 'thanks')] },
]

describe('foreign turns as our messages', () => {
  test('who spoke survives the projection', () => {
    // The bug this pins: a flat item list has no speaker, so every turn rendered as the same
    // neutral bubble and a conversation read as a monologue.
    expect(toMessages(turns, 'claude-code:abc').map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
  })

  test('a user turn carries content and an assistant turn carries items', () => {
    const [user, assistant] = toMessages(turns, 'claude-code:abc')
    // Our user bubble reads `content`; a user message has no tool activity to lay out.
    expect(user?.content).toBe('fix the auth bug')
    expect(user?.items).toBeUndefined()
    // The assistant card lays items out itself — prose as bubbles, tool runs folded into a chain.
    expect(assistant?.items?.map((item) => item.type)).toEqual(['text', 'tool_call'])
    expect(assistant?.content).toBeUndefined()
  })

  test('ids are namespaced by the session, so two open transcripts cannot collide', () => {
    const mine = toMessages(turns, 'claude-code:abc').map((message) => message.id)
    const theirs = toMessages(turns, 'codex:def').map((message) => message.id)
    expect(new Set([...mine, ...theirs]).size).toBe(mine.length + theirs.length)
    expect(mine[0]).toBe('claude-code:abc#turn-0')
  })

  test('an empty transcript projects to no messages rather than one empty turn', () => {
    expect(toMessages([], 'claude-code:abc')).toEqual([])
  })
})
