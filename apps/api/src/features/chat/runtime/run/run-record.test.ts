import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { AgentRuntime } from '@localixai/agent/runtime'
import type { Kysely } from 'kysely'

import { createAgentRunRepository } from '../../../../db/agent-run-repository'
import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import type { AppDatabase } from '../../../../db/types'
import { ActiveTurnTooLargeError, resolveContextBudgetFrame } from '../context-budget'
import { startAgentRunRecord } from './run-record'

/**
 * What survived the removal of the runtime journal: a run row, its terminal status, and the two
 * invariants that make the boot-restart notice trustworthy.
 *
 * The journal's other tests went with the tables they asserted on (`agent_session_entries`,
 * `agent_run_events`, `agent_run_checkpoints`) — nothing read those rows, so there was nothing left
 * to protect. The `agent_runs` row IS read, by `reclassifyInterruptedRuns` on the next boot.
 */
describe('agent run record', () => {
  const runtime = {
    adapter: { id: 'test-adapter', version: '1.2.3' },
    async disposeSession() {},
    run() {
      throw new Error('not used')
    },
  } satisfies AgentRuntime
  let db: Kysely<AppDatabase>

  const start = (repository: ReturnType<typeof createAgentRunRepository>, warnings?: string[]) =>
    startAgentRunRecord({
      repository,
      runtime,
      userId: 'user-1',
      sessionId: 'session-1',
      agentId: 'builtin:localix',
      providerId: 'p',
      modelId: 'm',
      now: () => '2026-07-31T10:00:00.000Z',
      ...(warnings ? { logger: { warn: (message: string) => void warnings.push(message) } } : {}),
    })

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    await db
      .insertInto('agent_sessions')
      .values({
        project_id: 'PRJ-test',
        id: 'session-1',
        user_id: 'user-1',
        title: 'record',
      })
      .execute()
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('records the adapter that ran and closes the row', async () => {
    const record = await start(createAgentRunRepository(db))
    expect(await db.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).toEqual({
      status: 'running',
    })

    await record.finish({ messages: [], terminal: 'completed' })

    expect(await db.selectFrom('agent_runs').selectAll().executeTakeFirstOrThrow()).toMatchObject({
      status: 'completed',
      adapter: 'test-adapter',
      adapter_version: '1.2.3',
      finished_at: '2026-07-31T10:00:00.000Z',
    })
  })

  test('a failed terminal write leaves the row for the boot sweep instead of throwing', async () => {
    const repository = createAgentRunRepository(db)
    repository.finishRun = async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    }
    const warnings: string[] = []
    const record = await start(repository, warnings)

    // Nothing thrown: the stream already ended successfully, and the caller's catch would have
    // turned this into `record.fail()` + a rethrow — reporting a COMPLETED run as failed.
    await record.finish({ messages: [], terminal: 'completed' })
    expect(warnings).toHaveLength(1)

    // The row stays `running`, which is exactly the state `reclassifyInterruptedRuns` sweeps on the
    // next boot (→ `interrupted` + PROCESS_RESTART). The one-active-run guard is not wedged.
    expect(await db.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).toEqual({
      status: 'running',
    })
  })

  test('a transient terminal failure still closes the run — and keeps its real status', async () => {
    const repository = createAgentRunRepository(db)
    const finishRun = repository.finishRun.bind(repository)
    let attempts = 0
    repository.finishRun = async (...args) => {
      attempts += 1
      if (attempts === 1) throw new Error('transient sqlite failure')
      return finishRun(...args)
    }
    const record = await start(repository)

    await record.finish({ messages: [], terminal: 'completed' })

    expect(attempts).toBe(2)
    expect(await db.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).toEqual({
      status: 'completed',
    })
    // Latched: the caller's catch path may still call fail(), and a closed run must not be reopened.
    await record.fail(new Error('late failure'))
    expect(attempts).toBe(2)
  })

  test('an ambiguous commit is accepted when retry observes the intended terminal state', async () => {
    const repository = createAgentRunRepository(db)
    const finishRun = repository.finishRun.bind(repository)
    let attempts = 0
    repository.finishRun = async (...args) => {
      attempts += 1
      if (attempts === 1) {
        await finishRun(...args)
        throw new Error('connection dropped after commit')
      }
      return finishRun(...args)
    }
    const warnings: string[] = []
    const record = await start(repository, warnings)

    await record.finish({ messages: [], terminal: 'completed' })

    expect(attempts).toBe(2)
    expect(warnings).toEqual([])
    expect(await db.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()).toEqual({
      status: 'completed',
    })
  })

  test('a conflicting terminal state is still rejected', async () => {
    const repository = createAgentRunRepository(db)
    const record = await start(repository)
    await record.finish({ messages: [], terminal: 'completed' })
    const run = await db.selectFrom('agent_runs').select('id').executeTakeFirstOrThrow()

    await expect(
      repository.finishRun('user-1', {
        runId: run.id,
        sessionId: 'session-1',
        status: 'failed',
        finishedAt: '2026-07-31T10:00:01.000Z',
      }),
    ).rejects.toThrow('already terminal')
  })

  test('records a local context failure as context_overflow instead of fatal', async () => {
    const record = await start(createAgentRunRepository(db))
    const frame = resolveContextBudgetFrame({ contextWindow: 256_000 })

    await record.fail(
      new ActiveTurnTooLargeError({
        frame,
        requiredTokens: frame.trigger + 1,
        availableTokens: frame.trigger,
        estimateSource: 'provider_anchor',
        message: 'The active tool loop is too large.',
      }),
    )

    expect(
      await db.selectFrom('agent_runs').select(['status', 'error_code']).executeTakeFirstOrThrow(),
    ).toEqual({ status: 'failed', error_code: 'context_overflow' })
  })

  test('a credential echoed back in a provider error does not reach agent_runs', async () => {
    // A failure persists the provider's own error message, and an upstream service reflecting the
    // credential it was sent is precisely the exposure the shield exists for. `error_code` stays
    // classified from the ORIGINAL error — redaction must not feed the classifier.
    const secret = 'sk-live-vault-abcdef123456'
    const record = await startAgentRunRecord({
      repository: createAgentRunRepository(db),
      runtime,
      userId: 'user-1',
      sessionId: 'session-1',
      agentId: 'builtin:localix',
      providerId: 'p',
      modelId: 'm',
      now: () => '2026-07-31T10:00:00.000Z',
      sanitize: (value) =>
        JSON.parse(JSON.stringify(value).split(secret).join('[vault-secret]')) as unknown,
    })

    await record.fail(new Error(`401 from upstream: key ${secret} is invalid`))

    const run = await db.selectFrom('agent_runs').selectAll().executeTakeFirstOrThrow()
    expect(run.error_json).not.toContain(secret)
    expect(run.error_json).toContain('[vault-secret]')
    expect(run.error_json).toContain('401 from upstream')
    expect(run).toMatchObject({ status: 'failed', error_code: 'fatal' })
  })

  test('a second concurrent run in one session is refused, not journaled', async () => {
    // Unlike the terminal write above, this guard is functional and MUST throw: two adapter runs
    // writing the same session would interleave their transcripts.
    const repository = createAgentRunRepository(db)
    await start(repository)
    // `Promise.resolve` because bun types `.rejects.toThrow()` as void; awaiting it directly trips
    // `await-thenable`. Same wrapper the other rejection assertions in this repo use.
    await Promise.resolve(expect(start(repository)).rejects.toThrow('already has an active run'))
  })
})
