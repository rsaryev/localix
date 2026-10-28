import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createToolUsageRepository } from './usage-repository'
import {
  recordToolRoster,
  recordToolUse,
  setToolRosterRecorder,
  setToolUsageRecorder,
} from './usage-recorder'

const tempDir = join(tmpdir(), `localix-tool-usage-repo-tests-${process.pid}`)

/**
 * The REAL database, migrations included — a fake would agree with a broken statement. Both
 * writers here are raw upserts whose whole correctness lives in SQLite's conflict resolution, so
 * a stub that "remembers what it was told" would prove nothing about either.
 */
async function makeDb() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return db
}

describe('tool usage repository', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('recordUse creates the row, then accumulates calls and errors', async () => {
    const db = await makeDb()
    const repo = createToolUsageRepository(db)

    expect(await repo.list('u1', '')).toEqual([])

    await repo.recordUse('u1', '', 'Read', { at: '2026-07-01T00:00:00.000Z' })
    await repo.recordUse('u1', '', 'Read', { at: '2026-07-02T00:00:00.000Z' })
    await repo.recordUse('u1', '', 'Read', { isError: true, at: '2026-07-03T00:00:00.000Z' })

    expect(await repo.list('u1', '')).toEqual([
      {
        toolName: 'Read',
        calls: 3,
        errors: 1,
        // The FIRST write's timestamp, never moved by the two that followed.
        firstSeenAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: '2026-07-03T00:00:00.000Z',
      },
    ])

    await destroyDatabase(db)
  })

  test('concurrent calls to one tool cannot lose an increment', async () => {
    const db = await makeDb()
    const repo = createToolUsageRepository(db)
    await repo.recordUse('u1', '', 'Bash')

    // Parallel tool execution is real (`executionMode: 'parallel'`), and sub-agents in one tree
    // share a scope. A read-then-write recorder collapses these to a much smaller number; the
    // arithmetic has to happen inside the statement.
    await Promise.all(Array.from({ length: 25 }, () => repo.recordUse('u1', '', 'Bash')))

    expect((await repo.list('u1', ''))[0]?.calls).toBe(26)

    await destroyDatabase(db)
  })

  test('recordRoster is idempotent and never clobbers counts or first_seen_at', async () => {
    const db = await makeDb()
    const repo = createToolUsageRepository(db)

    await repo.recordRoster('u1', '', ['Read', 'Search'], '2026-07-01T00:00:00.000Z')
    await repo.recordUse('u1', '', 'Read', { at: '2026-07-05T00:00:00.000Z' })
    // A later run surfaces the same roster plus one new name.
    await repo.recordRoster('u1', '', ['Read', 'Search', 'Bash'], '2026-07-09T00:00:00.000Z')

    const byName = new Map((await repo.list('u1', '')).map((row) => [row.toolName, row]))
    expect(byName.get('Read')).toEqual({
      toolName: 'Read',
      calls: 1,
      errors: 0,
      firstSeenAt: '2026-07-01T00:00:00.000Z',
      lastUsedAt: '2026-07-05T00:00:00.000Z',
    })
    // Never surfaced before this run, so its clock starts now — not at the first run's timestamp.
    expect(byName.get('Bash')?.firstSeenAt).toBe('2026-07-09T00:00:00.000Z')
    expect(byName.get('Bash')?.lastUsedAt).toBeNull()
    expect(byName.get('Search')?.calls).toBe(0)

    await destroyDatabase(db)
  })

  test('a repeated name in one batch is absorbed, and an empty one is dropped', async () => {
    const db = await makeDb()
    const repo = createToolUsageRepository(db)

    // The repeat is absorbed by SQLITE, not by us. This test used to be labelled "deduplicates
    // within its own batch" and justified a `Set` in the writer with the claim that a repeated
    // conflict target is an error. Measured against the real database, it is not: the first row
    // inserts, the rest are skipped. The `Set` went; this pins the behaviour we now rely on.
    //
    // The empty name is a different matter — it would be a real row keyed on nothing — so the
    // writer still filters those, and removing that filter DOES redden this.
    await repo.recordRoster('u1', '', ['Read', 'Read', '', 'Search'])

    expect((await repo.list('u1', '')).map((row) => row.toolName).sort()).toEqual([
      'Read',
      'Search',
    ])

    await destroyDatabase(db)
  })

  test('user, project and no-project scopes stay independent', async () => {
    const db = await makeDb()
    const repo = createToolUsageRepository(db)

    await repo.recordUse('u1', '', 'Read')
    await repo.recordUse('u1', 'proj-a', 'Read')
    await repo.recordUse('u2', '', 'Read')

    expect((await repo.list('u1', ''))[0]?.calls).toBe(1)
    expect((await repo.list('u1', 'proj-a'))[0]?.calls).toBe(1)
    expect((await repo.list('u2', ''))[0]?.calls).toBe(1)

    await destroyDatabase(db)
  })
})

describe('tool usage recorder', () => {
  afterEach(() => {
    setToolUsageRecorder(null)
    setToolRosterRecorder(null)
  })

  test('is a no-op with no sink registered', () => {
    expect(() => recordToolUse('Read', { userId: 'u1' })).not.toThrow()
    expect(() => recordToolRoster(['Read'], { userId: 'u1' })).not.toThrow()
  })

  test('normalizes a null project to the no-project scope', () => {
    const seen: unknown[] = []
    setToolUsageRecorder((toolName, scope) => void seen.push([toolName, scope]))

    recordToolUse('Read', { userId: 'u1', projectId: null })

    expect(seen).toEqual([['Read', { userId: 'u1', projectId: '', isError: false }]])
  })

  test('a throwing sink never propagates, synchronously or asynchronously', async () => {
    setToolUsageRecorder(() => {
      throw new Error('sink exploded')
    })
    expect(() => recordToolUse('Read', { userId: 'u1' })).not.toThrow()

    setToolUsageRecorder(() => Promise.reject(new Error('sink rejected')))
    expect(() => recordToolUse('Read', { userId: 'u1' })).not.toThrow()
    // An unhandled rejection would surface on the next tick, not at the call.
    await Promise.resolve()

    setToolRosterRecorder(() => {
      throw new Error('roster sink exploded')
    })
    expect(() => recordToolRoster(['Read'], { userId: 'u1' })).not.toThrow()
  })

  test('an empty roster does not reach the sink at all', () => {
    let calls = 0
    setToolRosterRecorder(() => void calls++)

    recordToolRoster([], { userId: 'u1' })

    expect(calls).toBe(0)
  })
})
