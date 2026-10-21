/**
 * The core's deletions as a plugin hears them (`host.changes.followCoreDeletions`): a read-only
 * consumer on the core stream that hands on agents, chats, projects and provider connections that
 * are gone — their refs only — and ignores everything else.
 *
 * An agent's catalog key is "deleted" on a rename too (`agents/service.ts` records the old key
 * deleted and the new one upserted together). A plugin storing the stable id must not unassign a
 * renamed agent, so an agent deletion is passed on only when no later notice brought its id back.
 */
import { sql, type Kysely } from 'kysely'
import type { CoreDeletion } from '@localixai/plugin-sdk/backend'
import type { ConsumerHandlers } from '@localixai/change-feed'
import type { AppDatabase } from '../../db/types'
import { CORE_STREAM, type CoreCascades, type CoreChangeFeed, type CoreRefs } from './core-entities'

type Handler = (deletion: CoreDeletion) => Promise<void> | void

/** True when the agent's stable id was upserted after its latest deletion (a rename). */
async function agentLivesOn(db: Kysely<AppDatabase>, agentId: string): Promise<boolean> {
  const rows = await db
    .selectFrom('change_events')
    .select(['seq', 'op'])
    .where('stream', '=', CORE_STREAM)
    .where('entity', '=', 'agent')
    .where(sql<string>`json_extract(ref_json, '$.agentId')`, '=', agentId)
    .orderBy('seq', 'desc')
    .limit(1)
    .execute()
  return rows[0]?.op === 'upserted'
}

export function coreDeletionHandlers(
  db: Kysely<AppDatabase>,
  handler: Handler,
): ConsumerHandlers<CoreRefs, CoreCascades> {
  return {
    agent: async (change) => {
      if (change.op !== 'deleted') return
      if (change.ref.agentId && (await agentLivesOn(db, change.ref.agentId))) return
      await handler({ entity: 'agent', ref: change.ref })
    },
    'chat.session': async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'chat', ref: change.ref })
    },
    project: async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'project', ref: change.ref })
    },
    'provider.connection': async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'provider.connection', ref: change.ref })
    },
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    mcp: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
  }
}

/** One plugin's core consumers, named `plugin:<plugin>:<consumer>`; a re-subscribe replaces. */
export function createCoreDeletionFollower(deps: {
  db: Kysely<AppDatabase>
  core: CoreChangeFeed
}) {
  const running = new Map<string, () => Promise<void>>()
  return async (pluginName: string, consumer: string, handler: Handler) => {
    const name = `plugin:${pluginName}:${consumer}`
    await running.get(name)?.()
    const started = await deps.core.subscribe(name, coreDeletionHandlers(deps.db, handler), {
      kind: 'reactor',
    })
    const stop = async () => {
      if (running.get(name) !== stop) return
      running.delete(name)
      await started.stop()
    }
    running.set(name, stop)
    return stop
  }
}
