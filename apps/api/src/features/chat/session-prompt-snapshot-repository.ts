import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { FrozenSessionContext } from './runtime/agent-runner-types'
import { frozenSessionContextSchema } from './runtime/frozen-session-context'

/** Durable prompt inputs, separate from the transcript and keyed by the session's boundary. */
export interface SessionPromptSnapshotRepository {
  get(
    userId: string,
    sessionId: string,
    boundary: string,
  ): Promise<FrozenSessionContext | undefined>
  set(
    userId: string,
    sessionId: string,
    boundary: string,
    snapshot: FrozenSessionContext,
  ): Promise<void>
}

export function createSessionPromptSnapshotRepository(
  db: Kysely<AppDatabase>,
): SessionPromptSnapshotRepository {
  return {
    async get(userId, sessionId, boundary) {
      const row = await db
        .selectFrom('session_prompt_snapshots')
        .select('snapshot_json')
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('boundary_marker', '=', boundary)
        .executeTakeFirst()
      // Corruption must fail the run rather than silently rebuild a different prompt prefix.
      return row ? frozenSessionContextSchema.parse(JSON.parse(row.snapshot_json)) : undefined
    },
    async set(userId, sessionId, boundary, snapshot) {
      const snapshotJson = JSON.stringify(frozenSessionContextSchema.parse(snapshot))
      const owned = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('id', '=', sessionId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!owned) throw new Error('Snapshot conversation is unavailable')
      await db
        .insertInto('session_prompt_snapshots')
        .values({
          user_id: userId,
          session_id: sessionId,
          boundary_marker: boundary,
          snapshot_json: snapshotJson,
        })
        .onConflict((oc) =>
          oc.columns(['user_id', 'session_id', 'boundary_marker']).doUpdateSet({
            snapshot_json: snapshotJson,
          }),
        )
        .execute()
    },
  }
}
