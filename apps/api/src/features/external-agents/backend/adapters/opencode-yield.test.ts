import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { opencodeAdapter } from './opencode'
import type { AdapterEnv } from './types'

/**
 * opencode keeps history in SQLite, and a statement is synchronous: the cold read of every session's
 * counts and usage held the shared event loop for 180 ms on a real 107 MB database. The sessions are
 * read in batches with a turn of the loop between them, counted here as turns, not as time.
 */
const dir = tempDirPerTest('ea-opencode-yield')
const SESSIONS = 40

function fixture(): AdapterEnv {
  const path = join(dir(), 'opencode.db')
  const db = new Database(path)
  db.run(
    'create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, data text)',
  )
  db.run(
    'create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)',
  )
  db.run(
    'create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)',
  )
  for (let i = 0; i < SESSIONS; i++) {
    db.run("insert into session values (?, null, '/work/app', ?, 1000, 2000, '{}')", [
      `ses_${i}`,
      `Session ${i}`,
    ])
    db.run('insert into message values (?, ?, 1000, 1000, ?)', [
      `m_${i}`,
      `ses_${i}`,
      JSON.stringify({ role: 'assistant', modelID: 'gpt-5.4', tokens: { input: 1, output: 1 } }),
    ])
  }
  db.close()
  return { env: { OPENCODE_DB: path }, homeDir: dir() }
}

describe('reading many opencode sessions lets the event loop turn', () => {
  test('the sessions are read in batches, a turn of the loop apart', async () => {
    const env = fixture()
    const refs = await opencodeAdapter.listSources(env)
    let turns = 0
    let counting = true
    const tick = () => {
      turns += 1
      if (counting) setImmediate(tick)
    }
    setImmediate(tick)
    const summaries = await opencodeAdapter.readSummaries(refs, env)
    counting = false

    expect(summaries).toHaveLength(SESSIONS)
    expect(summaries.every((s) => s.usage?.requests === 1)).toBe(true)
    // One file check turns it once or twice; five batches turn it at least four more times.
    expect(turns).toBeGreaterThanOrEqual(5)
  })
})
