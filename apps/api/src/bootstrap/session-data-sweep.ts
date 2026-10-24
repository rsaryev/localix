import { errorMessage } from '../lib/errors'
import type { IdleTask, IdleTaskContext } from '../lib/idle-tasks'
import { sweepOrphanSessionData } from '../features/mini-apps/session-storage'
import type { InfraPhase } from './infra'

/** Which of `ids` still have a session. Bounded batches: SQLite caps bound parameters. */
async function liveSessionIds(
  db: InfraPhase['db'],
  ids: readonly string[],
  ctx: IdleTaskContext,
): Promise<Set<string>> {
  const live = new Set<string>()
  for (let at = 0; at < ids.length; at += 500) {
    const rows = await db
      .selectFrom('agent_sessions')
      .select('id')
      .where('id', 'in', ids.slice(at, at + 500))
      .execute()
    for (const row of rows) live.add(row.id)
    await ctx.yield()
  }
  return live
}

/**
 * The idle task that removes session data whose session is gone (a crash mid-delete, a write
 * racing the delete): every user's. Once per start — deletion itself removes the folder.
 */
export function sessionDataSweepTask(
  db: InfraPhase['db'],
  logger: { info: (entry: object) => void; warn: (entry: object) => void },
): IdleTask {
  return {
    name: 'session_data_sweep',
    run: (ctx) =>
      sweepOrphanSessionData({ existing: (ids) => liveSessionIds(db, ids, ctx) })
        .then((removed) => {
          if (removed.length > 0) {
            logger.info({ event: 'session_data.swept', count: removed.length })
          }
        })
        .catch((error) =>
          logger.warn({ event: 'session_data.sweep_failed', error: errorMessage(error) }),
        ),
  }
}
