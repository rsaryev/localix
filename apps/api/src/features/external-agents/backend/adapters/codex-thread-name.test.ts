import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { codexAdapter } from './codex'
import type { AdapterEnv } from './types'

/**
 * Codex names its threads outside the rollout: `session_index.jsonl` beside `sessions/`, one
 * `{id, thread_name, updated_at}` line per naming, the latest last — what `/rename` writes and what
 * Codex's own resume picker lists. On a real history 136 of 219 conversations had a name, and the
 * list showed none of them: every row was the first prompt, cut at 120 characters.
 */
const dir = tempDirPerTest('ea-codex-name')
const ID = '019a0000-0000-7000-8000-000000000001'

function fixture(): AdapterEnv {
  const home = join(dir(), 'codex')
  const day = join(home, 'sessions', '2026', '08', '01')
  mkdirSync(day, { recursive: true })
  const rollout = [
    {
      type: 'session_meta',
      payload: { id: ID, cwd: '/work/app' },
      timestamp: '2026-08-01T10:00:00Z',
    },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the parser please' } },
  ]
  writeFileSync(
    join(day, `rollout-2026-08-01T10-00-00-${ID}.jsonl`),
    `${rollout.map((r) => JSON.stringify(r)).join('\n')}\n`,
  )
  return { env: { CODEX_HOME: home }, homeDir: dir() }
}

function name(env: AdapterEnv, threadName: string) {
  const line = { id: ID, thread_name: threadName, updated_at: '2026-08-01T11:00:00Z' }
  appendFileSync(
    join(env.env.CODEX_HOME as string, 'session_index.jsonl'),
    `${JSON.stringify(line)}\n`,
  )
}

async function title(env: AdapterEnv) {
  const refs = await codexAdapter.listSources(env)
  const [summary] = await codexAdapter.readSummaries(refs, env)
  return { title: summary?.title, revision: refs[0]?.revision }
}

describe('a Codex thread name', () => {
  test('a thread without a name is listed by its first prompt', async () => {
    expect((await title(fixture())).title).toBe('Fix the parser please')
  })

  test('a named thread is listed by its latest name', async () => {
    const env = fixture()
    name(env, 'Parser fix')
    name(env, 'Parser rewrite')
    expect((await title(env)).title).toBe('Parser rewrite')
  })

  test('renaming changes the revision, so a cached row is re-read', async () => {
    const env = fixture()
    const before = await title(env)
    name(env, 'Parser rewrite')
    expect((await title(env)).revision).not.toBe(before.revision)
  })
})
