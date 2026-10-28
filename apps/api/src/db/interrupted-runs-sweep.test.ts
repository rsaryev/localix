import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from './connection'
import { markInterruptedRunAnnounced, migrateToLatest, takeInterruptedRuns } from './migrator'

/**
 * The contract between the PRODUCER (the boot sweep) and the CONSUMER (the transcript
 * announcement), on a real database.
 *
 * Its absence is what let a no-op ship: the first version swept `agent_sessions.runtime_status =
 * 'running'` and announced only `chat` sessions — but a chat session NEVER reaches that status
 * (`markRuntimeSessionStatus` returns early for chat, `createSession` starts it `'idle'`), so the
 * two sets could not intersect and `announced` was always 0. Both halves were unit-tested; the
 * seam between them was not, and the unit test fabricated its own input rows.
 *
 * `agent_runs` is the right source: a run row is written for every session kind.
 */
describe('the boot sweep reports the sessions whose runs were interrupted', () => {
  let db: ReturnType<typeof createDatabase>
  const dir = join(tmpdir(), `localix-interrupted-sweep-tests-${process.pid}`)

  const seedSession = async (id: string, kind: 'chat' | 'job' | 'subagent') => {
    await db
      .insertInto('agent_sessions')
      .values({
        project_id: 'PRJ-test',
        id,
        user_id: 'u1',
        title: id,
        // The route columns are optional: this row does not need an agent to exist.
        session_kind: kind,
        // Exactly what production does: a chat session is created idle and STAYS idle.
        runtime_status: kind === 'chat' ? 'idle' : 'running',
      })
      .execute()
  }

  const seedRunningRun = async (sessionId: string) => {
    const runId = randomUUID()
    await db
      .insertInto('agent_runs')
      .values({
        id: runId,
        session_id: sessionId,
        agent_id: 'lead',
        status: 'running',
        provider_id: 'p',
        model_id: 'm',
        adapter: 'localix',
        adapter_version: '1',
        started_at: '2026-07-26T00:00:00.000Z',
      })
      .execute()
    return runId
  }

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    db = createDatabase({ filename: join(dir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    takeInterruptedRuns() // drain whatever the first migration reported
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  test('a CHAT session with an in-flight run is reported, with its owner', async () => {
    // The case the first version could not see. `runtime_status` is still 'idle' here — that column
    // is not the evidence, the run row is.
    await seedSession('chat-1', 'chat')
    const runId = await seedRunningRun('chat-1')

    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([
      { runId, sessionId: 'chat-1', userId: 'u1', agentId: 'lead' },
    ])

    const run = await db
      .selectFrom('agent_runs')
      .select(['status', 'error_code'])
      .where('session_id', '=', 'chat-1')
      .executeTakeFirstOrThrow()
    expect(run).toMatchObject({ status: 'interrupted', error_code: 'PROCESS_RESTART' })
    await markInterruptedRunAnnounced(db, runId)
  })

  test('a second boot reports nothing — the rows are no longer running', async () => {
    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([])
  })

  test('a pending notice survives another restart until it is acknowledged', async () => {
    await seedSession('chat-retry', 'chat')
    const runId = await seedRunningRun('chat-retry')

    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([
      { runId, sessionId: 'chat-retry', userId: 'u1', agentId: 'lead' },
    ])

    // Simulate a second process death after the run sweep but before the transcript insert.
    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([
      { runId, sessionId: 'chat-retry', userId: 'u1', agentId: 'lead' },
    ])

    await markInterruptedRunAnnounced(db, runId)
    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([])
  })

  test('worker sessions are reported too', async () => {
    // One RUNNING run per session is a schema guarantee:
    // `CREATE UNIQUE INDEX agent_runs_one_running_per_session ON agent_runs(session_id) WHERE
    // status = 'running'`.
    await seedSession('job-1', 'job')
    const jobRunId = await seedRunningRun('job-1')
    await seedSession('sub-1', 'subagent')
    const subagentRunId = await seedRunningRun('sub-1')

    await migrateToLatest(db)
    const reported = [...takeInterruptedRuns()].sort((a, b) =>
      a.sessionId.localeCompare(b.sessionId),
    )
    expect(reported).toEqual([
      { runId: jobRunId, sessionId: 'job-1', userId: 'u1', agentId: 'lead' },
      { runId: subagentRunId, sessionId: 'sub-1', userId: 'u1', agentId: 'lead' },
    ])
    await markInterruptedRunAnnounced(db, jobRunId)
    await markInterruptedRunAnnounced(db, subagentRunId)
  })

  test('reading drains the handoff, so a second consumer cannot double-announce', async () => {
    await seedSession('chat-2', 'chat')
    const runId = await seedRunningRun('chat-2')
    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toHaveLength(1)
    expect(takeInterruptedRuns()).toEqual([])
    await markInterruptedRunAnnounced(db, runId)
  })

  test('a clean boot with no in-flight run reports nothing', async () => {
    await seedSession('chat-3', 'chat')
    await migrateToLatest(db)
    expect(takeInterruptedRuns()).toEqual([])
  })
})
