import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

import type { MiniAppConfigValues } from './config'
import type { DiscoveredMiniApp } from './discovery'
import {
  createMiniAppInspectionStore,
  durableInspectionFingerprint,
  type MiniAppToolInspection,
} from './inspection-store'
import { inspectMiniAppTools } from './native'
import { createBoundedCache } from '../../lib/bounded-cache'

/**
 * The tool roster of one enabled native mini app, for the snapshot and Settings — without running
 * its `register()` again for an answer already known.
 *
 * Listing is read-only: it must not repeatedly run a native mini app's register() just to
 * rediscover the same tool names, within a process (the memory tier here) or across a restart
 * (the disk tier, `inspection-store.ts`). Both are keyed by the actual inspection inputs, local to
 * one mini app service (never process-global) and bounded. Runtime loading remains entirely
 * separate.
 */

type MiniAppConfig = MiniAppConfigValues

interface InspectionSnapshot {
  app: string
  projectId: string
  fingerprint: string
  result: Promise<MiniAppToolInspection>
}

const MAX_INSPECTION_SNAPSHOTS = 128

const cloneInspection = (value: MiniAppToolInspection): MiniAppToolInspection => ({
  tools: value.tools.map((tool) => ({ ...tool })),
  backendSubsystems: [...value.backendSubsystems],
  routeMounts: [...value.routeMounts],
  resourceProviders: [...value.resourceProviders],
  searchProviders: [...value.searchProviders],
  contextProviders: [...value.contextProviders],
  wsCommands: [...value.wsCommands],
  channels: [...value.channels],
  ...(value.error ? { error: value.error } : {}),
})

async function inspectionFingerprint(
  miniApp: DiscoveredMiniApp,
  config: MiniAppConfig,
  userId: string,
  cwd: string,
): Promise<string> {
  const entryVersions = await Promise.all(
    miniApp.backendEntries.map(async (entry) => {
      try {
        const stat = await fs.stat(entry)
        return [entry, stat.mtimeMs, stat.size]
      } catch {
        return [entry, 'missing']
      }
    }),
  )
  // Config may contain secrets. Retain only a digest in the cache metadata,
  // never the serialized config itself.
  return createHash('sha256')
    .update(JSON.stringify({ manifest: miniApp.manifest, config, entryVersions, userId, cwd }))
    .digest('hex')
}

export interface MiniAppInspections {
  inspect(
    miniApp: DiscoveredMiniApp,
    config: MiniAppConfig,
    userId: string,
    cwd: string,
  ): Promise<MiniAppToolInspection>
  /** A lifecycle change: drop `name` (in `projectId`, or everywhere for a global change), or all. */
  invalidate(name?: string, projectId?: string): void
}

export function createMiniAppInspections(deps: {
  homeDir: string
  logger?: { warn: (msg: string, meta?: unknown) => void }
}): MiniAppInspections {
  // Least recently used is evicted first, so a hot settings entry stays.
  const snapshots = createBoundedCache<string, InspectionSnapshot>({
    maxEntries: MAX_INSPECTION_SNAPSHOTS,
  })
  const store = createMiniAppInspectionStore(deps.homeDir)

  return {
    invalidate(name, projectId) {
      if (name === undefined) {
        snapshots.clear()
        store.drop()
        return
      }
      // A global mini app participates in every selected project. Its lifecycle or
      // config mutation invalidates every context-specific inspection; a
      // project-scoped mutation remains confined to that exact project.
      const matches = (entry: { app: string; projectId: string }) =>
        entry.app === name && ((projectId ?? '') === '' || entry.projectId === projectId)
      snapshots.deleteWhere(matches)
      store.drop(matches)
    },

    async inspect(miniApp, config, userId, cwd) {
      const key = `${miniApp.dir}\u0000${userId}\u0000${cwd}`
      const fingerprint = await inspectionFingerprint(miniApp, config, userId, cwd)
      const cached = snapshots.peek(key)
      if (cached?.fingerprint === fingerprint) {
        snapshots.get(key) // only a current snapshot counts as a use
        return cloneInspection(await cached.result)
      }

      // The durable read sits INSIDE the shared promise, so concurrent callers of one key (the
      // snapshot's two scopes, the cache warm) still share one attempt, disk hit or not.
      const run = async (): Promise<MiniAppToolInspection> => {
        const durable = await durableInspectionFingerprint(miniApp, fingerprint)
        const stored = durable ? await store.get(key, durable) : null
        if (stored) return stored
        const inspected = await inspectMiniAppTools(
          miniApp,
          config,
          { userId, cwd, homeDir: deps.homeDir },
          deps.logger,
        )
        // Only a result still current when it lands is persisted: an invalidation that ran while
        // it was in flight removed this snapshot, and its answer must not outlive that.
        if (durable && !inspected.error && snapshots.peek(key) === snapshot) {
          store.set(key, {
            app: snapshot.app,
            projectId: snapshot.projectId,
            fingerprint: durable,
            result: inspected,
          })
        }
        return inspected
      }
      const snapshot: InspectionSnapshot = {
        app: miniApp.name,
        projectId: miniApp.projectId,
        fingerprint,
        result: Promise.resolve().then(run),
      }
      snapshots.set(key, snapshot)

      try {
        const inspected = await snapshot.result
        // Import/register failures may be transient (an editor can be mid-save, a
        // dependency may appear later). Share the current in-flight attempt, but do
        // not freeze its error into every future settings refresh.
        if (inspected.error && snapshots.peek(key) === snapshot) snapshots.delete(key)
        return cloneInspection(inspected)
      } catch (error) {
        if (snapshots.peek(key) === snapshot) snapshots.delete(key)
        throw error
      }
    },
  }
}
