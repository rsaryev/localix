/**
 * `host.changes` for one plugin: the change feed on the plugin's own stream (`plugin:<name>`).
 * The core's registry is typed and closed; a plugin's kinds are its own, so its stream takes any
 * kind with a valid name and any JSON object as a ref — the plugin types its notices itself.
 * Every plugin feed is kept here so their retention runs with the core's. A plugin also follows
 * the core's deletions read-only (`core-deletions.ts`); it can never record on the core stream.
 */
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { ChangeFeedHost, MiniAppChange } from '@localixai/mini-app-sdk/backend'
import {
  createChangeFeed,
  recordChanges,
  type ChangeFeed,
  type ConsumerHandlers,
  type EntityRegistry,
  type RefSchemas,
} from '@localixai/change-feed'
import type { AppDatabase } from '../../db/types'
import { changeRetryDelayMs } from './retry'
import type { CoreChangeFeed } from './core-entities'
import { createCoreDeletionFollower } from './core-deletions'
import { agentLivesOn } from './change-events-repository'

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ANY_REF = z.record(z.string(), z.unknown())

/** Every kind a plugin names, with an object ref; no cascades (a plugin cleans up its own). */
const openRegistry: EntityRegistry<RefSchemas, Record<string, never>> = {
  refs: new Proxy({} as RefSchemas, {
    get: (_, kind) => (typeof kind === 'string' ? ANY_REF : undefined),
  }),
  cascades: {},
}

type Log = (event: string, detail: Record<string, unknown>) => void

export function createMiniAppChangeHosts(deps: {
  db: Kysely<AppDatabase>
  /** The core stream a plugin follows deletions on (read-only). */
  core: CoreChangeFeed
  log?: Log
}) {
  const followCore = createCoreDeletionFollower({
    agentLivesOn: (agentId) => agentLivesOn(deps.db, agentId),
    core: deps.core,
  })
  const feeds = new Map<string, ChangeFeed<RefSchemas, Record<string, never>>>()
  const feedFor = (stream: string) => {
    let feed = feeds.get(stream)
    if (!feed) {
      feed = createChangeFeed({
        db: deps.db,
        stream,
        registry: openRegistry,
        retryDelayMs: changeRetryDelayMs,
        log: deps.log,
      })
      feeds.set(stream, feed)
    }
    return feed
  }

  return {
    forMiniApp(pluginName: string): ChangeFeedHost {
      const stream = `plugin:${pluginName}`
      const valid = (change: MiniAppChange) => NAME.test(change.entity)
      return {
        record(changes) {
          const list = (Array.isArray(changes) ? changes : [changes]) as readonly MiniAppChange[]
          const kept = list.filter(valid)
          if (kept.length < list.length) {
            deps.log?.('changes.plugin_invalid_entity', { plugin: pluginName })
          }
          void recordChanges(deps.db, stream, kept)
        },
        async subscribe(consumer, handler) {
          if (!NAME.test(consumer)) throw new Error(`invalid change consumer name "${consumer}"`)
          // One handler answers for every kind the plugin names.
          const handlers = new Proxy({} as ConsumerHandlers<RefSchemas, Record<string, never>>, {
            get: () => (delivery: MiniAppChange) => handler(delivery),
          })
          // A plugin's handler acts on its own data; it is never rebuilt by the host.
          const started = await feedFor(stream).subscribe(consumer, handlers, { kind: 'reactor' })
          return () => started.stop()
        },
        async followCoreDeletions(consumer, handler) {
          if (!NAME.test(consumer)) throw new Error(`invalid change consumer name "${consumer}"`)
          return followCore(pluginName, consumer, handler)
        },
      }
    },

    /** Retention for every plugin stream (with the core's). */
    async prune(now?: number): Promise<number> {
      let removed = 0
      for (const feed of feeds.values()) removed += await feed.prune(now)
      return removed
    },

    async close() {
      for (const feed of feeds.values()) await feed.close()
      feeds.clear()
    },
  }
}

export type MiniAppChangeHosts = ReturnType<typeof createMiniAppChangeHosts>
