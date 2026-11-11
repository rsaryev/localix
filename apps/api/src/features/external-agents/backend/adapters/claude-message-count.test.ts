import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { claudeCodeAdapter } from './claude-code'
import type { AdapterEnv } from './types'

/**
 * What Claude Code's own picker counts as a conversation. A tool's result comes back as a `user`
 * record, so a turn that ran three tools read as four user messages. A transcript with no message
 * at all (a session opened and closed, or one holding only file snapshots) is one Claude Code cannot
 * resume and does not list, and it was a row titled by its id.
 */
const dir = tempDirPerTest('ea-claude-count')

function transcript(id: string, rows: readonly Record<string, unknown>[]): AdapterEnv {
  const project = join(dir(), '.claude', 'projects', '-work-app')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, `${id}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
  return { env: {}, homeDir: dir() }
}

const user = (uuid: string, content: unknown) => ({
  type: 'user',
  uuid,
  cwd: '/work/app',
  timestamp: '2026-08-01T10:00:00.000Z',
  message: { role: 'user', content },
})
const assistant = (id: string, content: unknown) => ({
  type: 'assistant',
  uuid: `${id}-record`,
  timestamp: '2026-08-01T10:00:01.000Z',
  message: { id, role: 'assistant', content },
})

async function summaryOf(env: AdapterEnv) {
  const refs = await claudeCodeAdapter.listSources(env)
  const [summary] = await claudeCodeAdapter.readSummaries(refs, env)
  return summary
}

describe('a Claude Code transcript', () => {
  test('a tool result is not a message', async () => {
    const env = transcript('aaaaaaaa-0000-4000-8000-000000000001', [
      user('u1', 'Fix the parser'),
      assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: 'file text' }]),
      assistant('m2', 'Fixed.'),
      user('u3', [{ type: 'text', text: 'Thanks' }]),
    ])
    const summary = await summaryOf(env)
    expect(summary?.messageCount).toBe(4)
    expect(summary?.empty).toBeUndefined()
  })

  test('a transcript without a message is marked empty', async () => {
    const env = transcript('aaaaaaaa-0000-4000-8000-000000000002', [
      { type: 'file-history-snapshot', messageId: 'x', snapshot: {} },
      { type: 'summary', summary: 'nothing' },
    ])
    const summary = await summaryOf(env)
    expect(summary?.messageCount).toBeUndefined()
    expect(summary?.empty).toBe(true)
  })
})
