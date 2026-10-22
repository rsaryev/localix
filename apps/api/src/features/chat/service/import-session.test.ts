import { sessionFixture } from '../../../testing/session-fixture'
import { describe, expect, test } from 'bun:test'

import {
  IMPORT_MAX_MESSAGES,
  importProblem,
  importSession,
  importedChars,
  type ImportSessionDeps,
  type ImportedMessage,
} from './import-session'
import type { PersistedMessage, SessionDetail } from '../contracts'

function deps(): ImportSessionDeps & { rows: PersistedMessage[]; created: unknown[] } {
  const rows: PersistedMessage[] = []
  const created: unknown[] = []
  let n = 0
  return {
    rows,
    created,
    async createSession(_userId, input) {
      created.push(input)
      return {
        ...sessionFixture(),
        id: 'LOCALIX-9',
        title: input.title,
      } as unknown as SessionDetail
    },
    repo: {
      async insertMessages(inputs) {
        rows.push(...inputs)
      },
    },
    now: () => '2026-08-03T00:00:00.000Z',
    newId: () => `m${(n += 1)}`,
  }
}

const turns: ImportedMessage[] = [
  { role: 'user', content: 'fix the auth bug' },
  {
    role: 'assistant',
    items: [
      { id: 'a', status: 'completed', type: 'text', text: 'Looking into it.' },
      {
        id: 'b',
        status: 'completed',
        type: 'tool_call',
        toolCallId: 'b',
        name: 'Bash',
        activeVerb: 'Running',
        resultText: 'ok',
      },
    ],
  },
]

describe('importing an outside conversation', () => {
  test('persists every turn in order, under one session', async () => {
    const d = deps()
    const session = await importSession(d, 'u1', { title: 'Fix auth', messages: turns })

    expect(session.id).toBe('LOCALIX-9')
    expect(d.created).toEqual([{ title: 'Fix auth' }])
    expect(d.rows.map((row) => row.payload.role)).toEqual(['user', 'assistant'])
    expect(d.rows.every((row) => row.sessionId === 'LOCALIX-9' && row.userId === 'u1')).toBe(true)
  })

  test('every imported turn shares one timestamp', async () => {
    // These turns were not written now, and spreading synthetic times across them would invent a
    // chronology the source never had. Their real order is the array's, kept by the sequence.
    const d = deps()
    await importSession(d, 'u1', { title: 'Fix auth', messages: turns })
    expect(new Set(d.rows.map((row) => row.createdAt)).size).toBe(1)
  })

  test('nothing is persisted when the import is refused', async () => {
    const d = deps()
    expect(importSession(d, 'u1', { title: 'Empty', messages: [] })).rejects.toThrow()
    expect(d.created).toHaveLength(0)
    expect(d.rows).toHaveLength(0)
  })

  test('the size limits name themselves so a caller can act', () => {
    expect(importProblem({ title: 't', messages: [] })).toContain('at least one message')
    const tooMany = Array.from({ length: IMPORT_MAX_MESSAGES + 1 }, (): ImportedMessage => ({
      role: 'user',
      content: 'x',
    }))
    expect(importProblem({ title: 't', messages: tooMany })).toContain(String(IMPORT_MAX_MESSAGES))
    expect(importProblem({ title: 't', messages: turns })).toBeNull()
  })

  test('counted characters include what the items carry, not just the prose', () => {
    // A transcript's weight lives in tool output, so a budget that only measured `content` would
    // wave through the imports that actually matter.
    expect(importedChars([{ role: 'user', content: 'abc' }])).toBe(3)
    expect(importedChars(turns)).toBe('fix the auth bug'.length + 'Looking into it.'.length + 2)
  })
})
