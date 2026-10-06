import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claudeCodeAdapter } from './claude-code'
import type { AdapterEnv } from './types'

async function fixture(): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'claude-usage-'))
  const project = join(home, '.claude', 'projects', '-work-app')
  await mkdir(project, { recursive: true })
  const rows = [
    {
      type: 'user',
      uuid: 'user-1',
      cwd: '/work/app',
      timestamp: '2026-08-01T10:00:00.000Z',
      message: { id: 'user-1', role: 'user', content: 'Fix the parser' },
    },
    {
      type: 'assistant',
      uuid: 'record-1',
      timestamp: '2026-08-01T10:01:00.000Z',
      message: {
        id: 'request-1',
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: 'Working',
        // Streaming snapshot: this request is repeated below with its final output count.
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 2,
        },
      },
    },
    {
      type: 'assistant',
      uuid: 'record-2',
      timestamp: '2026-08-01T10:01:01.000Z',
      message: {
        id: 'request-1',
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: 'Working',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 12,
        },
      },
    },
    {
      type: 'assistant',
      uuid: 'record-3',
      timestamp: '2026-08-02T10:00:00.000Z',
      message: {
        id: 'request-2',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: 'Done',
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 40,
          output_tokens: 8,
        },
      },
    },
  ]
  await writeFile(
    join(project, '019fbea7-a356-75a0-8d14-c3362752cc71.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n'),
    'utf8',
  )
  return { env: {}, homeDir: home }
}

describe('Claude Code measured usage', () => {
  test('deduplicates streaming snapshots and retains model/day attribution', async () => {
    const env = await fixture()
    const refs = await claudeCodeAdapter.listSources(env)
    const [summary] = await claudeCodeAdapter.readSummaries(refs, env)

    expect(summary?.messageCount).toBe(3)
    expect(summary?.usage).toMatchObject({
      inputTokens: 15,
      cachedInputTokens: 70,
      cacheWriteTokens: 20,
      outputTokens: 20,
      totalTokens: 125,
      requests: 2,
    })
    expect(summary?.usage?.byDay.map((day) => day.day)).toEqual(['2026-08-01', '2026-08-02'])
    expect(summary?.usage?.byModel.map((model) => model.model)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ])
  })
})
