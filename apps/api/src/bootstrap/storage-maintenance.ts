import { checkpointWal, ensureIncrementalVacuum, reclaimFreePages } from '../db/storage'
import { errorMessage } from '../lib/errors'
import type { IdleTaskContext } from '../lib/idle-tasks'
import { compactArtifacts, sweepOrphanChunks } from '../features/context-store/maintenance'
import type { InfraPhase } from './infra'

/**
 * Keep the database file from growing without bound: compress the tool outputs written before
 * outputs were compressed, drop search sections of deleted sessions, switch an existing file to
 * incremental auto-vacuum (once), hand freed pages back and empty the write-ahead log. Each step is
 * bounded and repeatable; a failure in one is logged and the next still runs.
 */
export function createStorageMaintenance(deps: {
  db: InfraPhase['db']
  logger: InfraPhase['logger']
  signal: AbortSignal
}): (ctx?: IdleTaskContext) => Promise<void> {
  const { db, logger, signal } = deps
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run()
    } catch (error) {
      logger.warn({ event: 'storage.step_failed', step: name, error: errorMessage(error) })
      return undefined
    }
  }
  return async (ctx) => {
    const compacted = await step('compact', () =>
      compactArtifacts(db, {
        yieldToLoop: ctx ? () => ctx.yield() : undefined,
        aborted: () => signal.aborted,
      }),
    )
    const orphans = await step('orphan_chunks', () => sweepOrphanChunks(db))
    const vacuum = await step('vacuum', () => ensureIncrementalVacuum(db))
    const free = await step('reclaim', () => reclaimFreePages(db))
    await step('checkpoint', () => checkpointWal(db))
    logger.info({
      event: 'storage.maintained',
      compactedRows: compacted?.rows ?? 0,
      savedBytes: compacted?.savedBytes ?? 0,
      orphanChunks: orphans ?? 0,
      vacuum: vacuum?.status,
      freePagesBefore: free,
    })
  }
}
