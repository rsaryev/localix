import type { Kysely } from 'kysely'

import type { AgentRunStatus, AppDatabase } from './types'

/**
 * `agent_runs`, and nothing else.
 *
 * This file is what remains of a much larger `runtime-session-repository.ts`, which also owned an
 * append-only runtime session tree (`agent_session_entries`), a per-run event log
 * (`agent_run_events`), turn checkpoints (`agent_run_checkpoints`) and a compaction lifecycle
 * (`agent_compactions`). All four were write-only — their read methods had no production caller —
 * and they were dropped in `migrations/20260731T010000_drop_runtime_journal.ts`.
 *
 * The run row survives because it has a genuine reader: `reclassifyInterruptedRuns` (`migrator.ts`)
 * sweeps rows left `running` by a process death, and `announceInterruptedRuns` turns each one into
 * a durable transcript notice so the user is not left staring at a silently truncated reply. That
 * sweep is the reason this repository still exists at all.
 */

export class AgentRunNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} was not found`)
    this.name = 'AgentRunNotFoundError'
  }
}

export class AgentRunActiveError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} already has an active run`)
    this.name = 'AgentRunActiveError'
  }
}

export class AgentRunIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentRunIntegrityError'
  }
}

export interface NewAgentRun {
  id: string
  sessionId: string
  agentId: string
  providerId: string
  modelId: string
  credentialId: string | null
  adapter: string
  adapterVersion: string
  startedAt: string
}

export function createAgentRunRepository(db: Kysely<AppDatabase>) {
  /**
   * `agent_runs` has no `user_id`: the boot sweep reads the owner by joining `agent_sessions`. So
   * ownership has to be proven HERE, or a run written against someone else's session id would make
   * that join announce a restart notice into their transcript.
   */
  const requireOwnedSession = async (
    exec: Kysely<AppDatabase>,
    userId: string,
    sessionId: string,
  ): Promise<void> => {
    const row = await exec
      .selectFrom('agent_sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!row) throw new AgentRunNotFoundError(sessionId)
  }

  return {
    /**
     * Open the durable run row. Unlike every other write in this file's ancestor, refusing a second
     * concurrent run in one session is a FUNCTIONAL guard, checked before any provider work — it
     * must keep throwing rather than degrade. The partial unique index
     * (`agent_runs_one_running_per_session`) is the cross-process backstop; the pre-check exists to
     * report the collision as a typed error instead of a raw SQLITE_CONSTRAINT.
     */
    async startRun(userId: string, input: NewAgentRun): Promise<void> {
      await db.transaction().execute(async (tx) => {
        await requireOwnedSession(tx, userId, input.sessionId)
        const activeRun = await tx
          .selectFrom('agent_runs')
          .select('id')
          .where('session_id', '=', input.sessionId)
          .where('status', '=', 'running')
          .executeTakeFirst()
        if (activeRun) throw new AgentRunActiveError(input.sessionId)
        await tx
          .insertInto('agent_runs')
          .values({
            id: input.id,
            session_id: input.sessionId,
            agent_id: input.agentId,
            status: 'running',
            provider_id: input.providerId,
            model_id: input.modelId,
            credential_id: input.credentialId,
            adapter: input.adapter,
            adapter_version: input.adapterVersion,
            error_code: null,
            error_json: null,
            started_at: input.startedAt,
            finished_at: null,
          })
          .execute()
      })
    },

    /**
     * Close the run row idempotently. The `status = 'running'` predicate is the commit point; a
     * retry that observes the same terminal state succeeds, while a conflicting terminal state
     * still proves that another lifecycle owner won and throws.
     */
    async finishRun(
      userId: string,
      input: {
        runId: string
        sessionId: string
        status: Exclude<AgentRunStatus, 'running'>
        finishedAt: string
        errorCode?: string | null
        error?: { name: string; message: string }
      },
    ): Promise<void> {
      await requireOwnedSession(db, userId, input.sessionId)
      const result = await db
        .updateTable('agent_runs')
        .set({
          status: input.status,
          error_code: input.errorCode ?? null,
          error_json: input.error === undefined ? null : JSON.stringify(input.error),
          finished_at: input.finishedAt,
        })
        .where('id', '=', input.runId)
        .where('session_id', '=', input.sessionId)
        .where('status', '=', 'running')
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1) {
        const existing = await db
          .selectFrom('agent_runs')
          .select('status')
          .where('id', '=', input.runId)
          .where('session_id', '=', input.sessionId)
          .executeTakeFirst()
        if (existing?.status === input.status) return
        throw new AgentRunIntegrityError(`Run ${input.runId} is missing or already terminal`)
      }
    },
  }
}

export type AgentRunRepository = ReturnType<typeof createAgentRunRepository>
