import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { ExecutionAddress } from '../agent-core/execution-address'
import type { FrozenSessionContext } from './runtime/agent-runner-types'
import { frozenSessionContextSchema } from './runtime/frozen-session-context'

/** Durable prompt inputs, separate from the transcript and keyed by the agent's boundary. */
export interface ParticipantLaneSnapshotRepository {
  get(
    userId: string,
    address: ExecutionAddress,
    boundary: string,
  ): Promise<FrozenSessionContext | undefined>
  set(
    userId: string,
    address: ExecutionAddress,
    boundary: string,
    snapshot: FrozenSessionContext,
  ): Promise<void>
}

export function createParticipantLaneSnapshotRepository(
  db: Kysely<AppDatabase>,
): ParticipantLaneSnapshotRepository {
  return {
    async get(userId, address, boundary) {
      const row = await db
        .selectFrom('participant_lane_snapshots')
        .select('snapshot_json')
        .where('user_id', '=', userId)
        .where('session_id', '=', address.sessionId)
        .where('agent_id', '=', address.agentId)
        .where('boundary_marker', '=', boundary)
        .executeTakeFirst()
      // Corruption must fail the run rather than silently rebuild a different prompt prefix.
      return row ? frozenSessionContextSchema.parse(JSON.parse(row.snapshot_json)) : undefined
    },
    async set(userId, address, boundary, snapshot) {
      const snapshotJson = JSON.stringify(frozenSessionContextSchema.parse(snapshot))
      const owned = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('id', '=', address.sessionId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      if (!owned) throw new Error('Snapshot conversation is unavailable')
      await db
        .insertInto('participant_lane_snapshots')
        .values({
          user_id: userId,
          session_id: address.sessionId,
          agent_id: address.agentId,
          boundary_marker: boundary,
          snapshot_json: snapshotJson,
        })
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'session_id', 'agent_id', 'boundary_marker'])
            .doUpdateSet({ snapshot_json: snapshotJson }),
        )
        .execute()
    },
  }
}
