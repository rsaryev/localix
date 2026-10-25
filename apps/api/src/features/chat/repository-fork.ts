import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { forkSeedSchema, type ForkSeed } from '../agent-core/fork-seed'

/** A fork's seed has one row per fork: the lane table's shape, under its own boundary. */
const SEED_BOUNDARY = 'fork-seed'
const SEED_AGENT = 'fork'

/**
 * What a fork needs from the store beyond its own rows: where its parent's line was cut, and the
 * seed (system prompt, tools, route key) its parent's run handed it. The seed rides the table of
 * frozen prompt inputs: it is the same kind of fact, written once and read by every run.
 */
export function createForkQueries(db: Kysely<AppDatabase>) {
  return {
    /** The row a message follows, or null when it is a root or does not exist. */
    async messageParent(
      userId: string,
      sessionId: string,
      messageId: string,
    ): Promise<string | null> {
      const row = await db
        .selectFrom('agent_messages')
        .select('parent_id')
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', messageId)
        .executeTakeFirst()
      return row?.parent_id ?? null
    },

    async getForkSeed(userId: string, sessionId: string): Promise<ForkSeed | undefined> {
      const row = await db
        .selectFrom('participant_lane_snapshots')
        .select('snapshot_json')
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('agent_id', '=', SEED_AGENT)
        .where('boundary_marker', '=', SEED_BOUNDARY)
        .executeTakeFirst()
      // A seed this build cannot read fails the run: another prompt would be another prefix.
      return row ? forkSeedSchema.parse(JSON.parse(row.snapshot_json)) : undefined
    },

    async setForkSeed(userId: string, sessionId: string, seed: ForkSeed): Promise<void> {
      const snapshotJson = JSON.stringify(forkSeedSchema.parse(seed))
      await db
        .insertInto('participant_lane_snapshots')
        .values({
          user_id: userId,
          session_id: sessionId,
          agent_id: SEED_AGENT,
          boundary_marker: SEED_BOUNDARY,
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
