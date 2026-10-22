import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import type { ChannelBinding, ChannelBindingStore } from './mcp-channels'

/**
 * Where each Claude Code channel server speaks (`mcp-channels.ts`), kept across restarts: one row
 * per server identity and working directory, the chat that last gathered it. A deleted chat takes
 * its rows with it (foreign key); a server that no longer resolves at boot is forgotten there.
 */
export function createChannelBindingRepository(db: Kysely<AppDatabase>): ChannelBindingStore {
  return {
    async save(binding, at) {
      await db
        .insertInto('mcp_channel_bindings')
        .values({
          user_id: binding.userId,
          server_id: binding.serverId,
          cwd: binding.cwd,
          project_id: binding.projectId,
          scope: binding.scope,
          session_id: binding.sessionId,
          bound_at: at,
        })
        .onConflict((oc) =>
          oc.columns(['user_id', 'server_id', 'cwd']).doUpdateSet({
            project_id: binding.projectId,
            scope: binding.scope,
            session_id: binding.sessionId,
            bound_at: at,
          }),
        )
        .execute()
    },
    async list(): Promise<ChannelBinding[]> {
      const rows = await db
        .selectFrom('mcp_channel_bindings')
        .selectAll()
        .orderBy('bound_at')
        .execute()
      return rows.map((row) => ({
        userId: row.user_id,
        serverId: row.server_id,
        cwd: row.cwd,
        projectId: row.project_id,
        scope: row.scope,
        sessionId: row.session_id,
      }))
    },
    async remove(binding) {
      await db
        .deleteFrom('mcp_channel_bindings')
        .where('user_id', '=', binding.userId)
        .where('server_id', '=', binding.serverId)
        .where('cwd', '=', binding.cwd)
        .execute()
    },
  }
}
