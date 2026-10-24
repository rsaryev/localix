import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import { ccTranscriptText } from './cc-transcript-lines'

const message = (id: string, payload: Record<string, unknown>): PersistedMessage =>
  ({
    id,
    sessionId: 's1',
    userId: 'u1',
    payload,
    createdAt: '2026-10-23T10:00:00.000Z',
    updatedAt: '2026-10-23T10:00:00.000Z',
  }) as unknown as PersistedMessage

const conversation = [
  message('m1', { role: 'user', content: 'Delete the build folder' }),
  message('m2', {
    role: 'assistant',
    content: 'Removed it.',
    turnEnd: { modelId: 'sonnet' },
    items: [
      { id: 'a', type: 'text', status: 'completed', text: 'Removing it.', turnIndex: 0 },
      {
        id: 'b',
        type: 'command',
        status: 'completed',
        toolCallId: 'call-1',
        name: 'bash',
        input: { command: 'rm -rf build' },
        resultText: 'ok',
        command: 'rm -rf build',
        turnIndex: 0,
      },
      {
        id: 'c',
        type: 'text',
        status: 'completed',
        text: 'Removed it. <promise>DONE</promise>',
        turnIndex: 1,
      },
    ],
  }),
  message('m3', { role: 'user', content: 'internal', isInternal: true }),
  message('m4', { role: 'assistant', content: 'Blocked', systemNotice: { kind: 'x' } }),
]

describe('cc transcript lines', () => {
  test('a conversation is written as Claude Code writes its transcript', () => {
    const lines = ccTranscriptText(conversation, { sessionId: 'root', cwd: '/w' })
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, any>)
    expect(lines.map((line) => [line.type, line.message.role])).toEqual([
      ['user', 'user'],
      ['assistant', 'assistant'],
      ['user', 'user'],
      ['assistant', 'assistant'],
    ])
    expect(lines[0]).toMatchObject({
      parentUuid: null,
      isSidechain: false,
      sessionId: 'root',
      cwd: '/w',
      message: { content: 'Delete the build folder' },
    })
    expect(lines[1]!.message.content).toEqual([
      { type: 'text', text: 'Removing it.' },
      { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'rm -rf build' } },
    ])
    expect(lines[1]!.message.model).toBe('sonnet')
    expect(lines[2]!.message.content).toEqual([
      { type: 'tool_result', tool_use_id: 'call-1', content: 'ok', is_error: false },
    ])
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.parentUuid).toBe(lines[i - 1]!.uuid)
  })

  test('ralph-loop finds the last assistant text the way its stop hook reads it', () => {
    const text = ccTranscriptText(conversation, { sessionId: 'root', cwd: '/w' })
    // grep '"role":"assistant"' | jq -rs 'map(.message.content[]? | select(.type == "text") | .text) | last'
    const last = text
      .split('\n')
      .filter((line) => line.includes('"role":"assistant"'))
      .map(
        (line) => JSON.parse(line) as { message: { content: { type: string; text?: string }[] } },
      )
      .flatMap((line) => line.message.content.filter((block) => block.type === 'text'))
      .at(-1)?.text
    expect(last).toBe('Removed it. <promise>DONE</promise>')
  })

  test('the same conversation gives the same text, and a subagent’s is a sidechain', () => {
    const meta = { sessionId: 'root', cwd: '/w', agentId: 'child' }
    expect(ccTranscriptText(conversation, meta)).toBe(ccTranscriptText(conversation, meta))
    const [first] = ccTranscriptText(conversation, meta).split('\n')
    expect(JSON.parse(first!)).toMatchObject({ isSidechain: true, agentId: 'child' })
    expect(ccTranscriptText([], meta)).toBe('')
  })

  test('a file tool’s tool_use carries its path absolute, as Claude Code writes it', () => {
    const edit = message('m5', {
      role: 'assistant',
      items: [
        {
          id: 'e',
          type: 'file_change',
          status: 'completed',
          toolCallId: 'call-2',
          name: 'write',
          input: { files: [{ path: 'notes/a.md', content: 'x' }] },
          resultText: 'Wrote notes/a.md',
          turnIndex: 0,
        },
      ],
    })
    const [line] = ccTranscriptText([edit], { sessionId: 'root', cwd: '/w' }).split('\n')
    const use = JSON.parse(line!).message.content[0]
    expect(use).toMatchObject({ name: 'Write', input: { file_path: '/w/notes/a.md' } })
  })
})
